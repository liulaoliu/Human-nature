import { detectSpeechSpans } from '../core/vad'
import { applyChunkEdits } from '../core/chunkEdits'
import { latestTakePerChunk, remapTakes } from '../core/takeChunk'
import { alignScript, resolveScriptAnchors, scriptWords, type ScriptLayout } from '../core/scriptAlign'
import { AUTO_CYCLE_GAP_MS } from '../core/recording'
import {
  GRANULARITY_MS,
  type Chunk,
  type Granularity,
  type MicOptions,
  type Take,
} from '../core/ports'
import { CalibrationLedger } from './calibrationLedger'
import { LevelMeter } from './levelMeter'
import { AnchorEditor } from './anchorEditor'
import { CycleRunner } from './cycleRunner'
import { ChunkEditor } from './chunkEditor'
import { PlaybackController } from './playbackController'
import { RecordingController } from './recordingController'
import { INITIAL, type SessionDeps, type SessionState } from './sessionConfig'

export type { SessionDeps, SessionState } from './sessionConfig'

/**
 * ViewModel。不依赖 React，所以可以直接单测。
 * React 通过 useSyncExternalStore 订阅。
 *
 * 这一层只做**编排**：状态机、播放/录音的时序、竞态守卫。
 * 容易膨胀的逻辑已经各归各位：
 * - 每篇的手动校准（平移/起点/锚点/撕合）→ `state/calibrationLedger`
 * - 「原文怎么摊到块上」的规则 → `core/scriptAlign`
 * - 录音与块的对应、判定阈值与兜底时长 → `core/takeChunk` / `core/recording`
 * - 一次录音的全流程（开麦→统计→落库→淘汰旧录音）→ `state/recordingController`
 * - 手动撕开/合并（含「快路径 vs 重跑 VAD」的取舍）→ `state/chunkEditor`
 */
export class SessionStore {
  private state: SessionState = INITIAL
  private listeners = new Set<() => void>()
  private generation = 0 // load 竞态守卫
  /** 每篇的校准（平移 / 起点 / 锚点 / 撕合），按文件名分篇 */
  private cal: CalibrationLedger
  /** 锚点的增删改（规则在 core/anchorEdits，跟账本打交道的部分在这里） */
  private anchors: AnchorEditor
  /** 连续跟读的那一轮（轮次号 / 录音定时器 / 说过话没有），见 state/cycleRunner */
  private cycle: CycleRunner
  /** 一次录音：开麦、电平统计、落库、淘汰旧录音，见 state/recordingController */
  private rec: RecordingController
  /** 手动撕开 / 合并块，见 state/chunkEditor */
  private edits: ChunkEditor
  /** 导航与参考音播放（切块 / 空格 / 整篇 / 试听），见 state/playbackController */
  private play: PlaybackController
  /**
   * 电平上报的节流（~25/s）：电平表每帧都回调，直接进 state 就是 60fps 整页重渲染。
   * 判定「说完没有」用**原始值**（不受节流影响），只有给 UI 看的 level 才节流。
   */
  private level = new LevelMeter((v) => this.set({ level: v }))

  constructor(private deps: SessionDeps) {
    this.cal = new CalibrationLedger(deps.calibration)
    this.cycle = new CycleRunner({
      state: () => this.state,
      set: (patch) => this.set(patch),
      chunk: () => this.chunk(),
      player: deps.player,
      recorder: deps.recorder,
      startRecording: () => this.startRecording(),
      stopRecording: () => this.stopRecording(),
      playTake: (take) => this.playTake(take),
      stopAb: () => this.stopAb(),
      cycleGapMs: () => deps.cycleGapMs ?? AUTO_CYCLE_GAP_MS,
      hangoverMs: () => deps.voiceHangoverMs ?? this.state.hangoverMs,
    })
    this.anchors = new AnchorEditor({
      cal: this.cal,
      fileName: () => this.state.fileName,
      words: () => this.wordList(),
      chunk: () => this.chunk(),
      alignedWordRange: (i) => this.state.aligned[i]?.wordRange ?? null,
      persist: () => this.cal.persist(this.state.fileName),
    })
    this.rec = new RecordingController({
      state: () => this.state,
      set: (patch) => this.set(patch),
      chunk: () => this.chunk(),
      player: deps.player,
      recorder: deps.recorder,
      repo: deps.repo,
      level: this.level,
      voiceLevel: () => deps.voiceLevel,
      abortCycle: () => this.abortCycle(),
      stopAb: () => this.stopAb(),
      playTake: (take) => this.playTake(take),
    })
    this.edits = new ChunkEditor({
      state: () => this.state,
      chunk: () => this.chunk(),
      cal: this.cal,
      anchors: this.anchors,
      deriveAt: (g, fileName) =>
        this.derive(this.deps.player.samples, this.deps.player.sampleRate, g, fileName),
      realign: (patch) => this.realign(patch),
    })
    this.play = new PlaybackController({
      state: () => this.state,
      set: (patch) => this.set(patch),
      chunk: () => this.chunk(),
      player: deps.player,
      stopAb: () => this.stopAb(),
      abortCycle: () => this.abortCycle(),
      runAutoCycle: () => this.runAutoCycle(),
    })
    this.deps.recorder.onLevel((v) => {
      // 阈值只在录音期间有意义（noteLevel 内部也只在那时统计），
      // 连续跟读的「说完没有」用它判定。
      const thr = this.rec.noteLevel(v)
      this.cycle.noteLevel(v, thr)
      this.level.accept(v)
    })
  }


  getState = (): SessionState => this.state

  subscribe = (cb: () => void): (() => void) => {
    this.listeners.add(cb)
    return () => this.listeners.delete(cb)
  }

  private set(patch: Partial<SessionState>) {
    this.state = { ...this.state, ...patch }
    for (const cb of this.listeners) cb()
  }

  // ---- 加载 ----

  async load(blob: Blob, fileName: string): Promise<void> {
    const gen = ++this.generation
    this.set({ status: 'loading', fileName, error: null })
    try {
      await this.deps.player.load(blob)
      if (gen !== this.generation) return // 已被更新的 load 取代

      // 只取这一篇的录音（IndexedDB 走 fileName 索引，不把别的文章的 blob 读进来）。
      // 老记录没有 fileName，取不出来——那些本来也分不清是哪篇的。
      const all = await this.deps.repo.listByFile(fileName)
      if (gen !== this.generation) return

      // 把上次存的校准（文字偏移 / 正文起点 / 手动锚点 / 手动撕合）读回来，刷新页面不丢
      this.cal.hydrate(fileName)

      const chunks = this.derive(
        this.deps.player.samples,
        this.deps.player.sampleRate,
        this.state.granularity,
        fileName,
      )

      // 录音挂到「现在」的块上：块号会变（切块档位、手动撕开），按音频时间找块
      const takes = latestTakePerChunk(remapTakes(all, chunks))
      for (const t of all) {
        if (!takes.some((k) => k.id === t.id)) void this.deps.repo.remove(t.id)
      }

      // 换文件意味着换文章，旧的原文留着只会误导，先清掉，
      // 然后按文件名从原文库里找这一篇，找到就直接摊到块上。
      const found = await this.deps.scripts?.find(fileName)
      if (gen !== this.generation) return
      // 手动改过的正文优先于原文库 —— 改了文本、刷新后不该被 json 覆盖回去
      const edited = this.deps.scriptEdits?.get(fileName)
      const script = edited ?? found?.text ?? ''
      const scriptSource: 'auto' | 'manual' | 'none' =
        edited !== undefined ? 'manual' : script ? 'auto' : 'none'
      const layout = this.layout(script, chunks, fileName)
      const ranges = resolveScriptAnchors(layout)

      this.set({
        status: 'ready',
        duration: this.deps.player.duration,
        chunks,
        takes,
        current: 0,
        abPlaying: false,
        recording: false,
        playing: false,
        pausedChunk: null,
        script,
        scriptSource,
        scriptLibrary: found?.library ?? false,
        offsetWords: this.cal.offsetOf(fileName),
        textStartChunk: this.cal.startOf(fileName),
        manualAnchors: ranges.length,
        manualRanges: ranges,
        chunkEditCount: this.cal.editCountOf(fileName),
        splitPoints: this.cal.splitsOf(fileName),
        aligned: alignScript(layout),
      })
    } catch (e) {
      if (gen !== this.generation) return
      this.set({ status: 'error', error: e instanceof Error ? e.message : String(e) })
    }
  }

  /** 只跑 VAD，得到原始块（不含手动撕/合） */
  private detect(samples: Float32Array, sampleRate: number, g: Granularity): Chunk[] {
    if (samples.length === 0 || sampleRate === 0) return []
    return detectSpeechSpans(samples, sampleRate, {
      mergeGapMs: GRANULARITY_MS[g],
      minSpeechMs: 200,
    }).map((s, index) => ({ index, start: s.start, end: s.end }))
  }

  /** VAD 切块 + 套上这一篇的手动撕/合 */
  private derive(samples: Float32Array, sampleRate: number, g: Granularity, fileName = this.state.fileName): Chunk[] {
    const base = this.detect(samples, sampleRate, g)
    return applyChunkEdits(base, this.cal.splitsOf(fileName), this.cal.mergesOf(fileName))
  }

  setGranularity(g: Granularity) {
    if (g === this.state.granularity || this.state.status !== 'ready') return
    // 锚点/撕合都按音频时间记，块变了照样能找回是哪一块
    this.edits.rederive({ granularity: g })
  }

  setRate(rate: number) {
    this.set({ rate })
  }

  /** 「说完静音多久算结束」（毫秒），夹在 0.8～15 秒 */
  setHangoverMs(ms: number) {
    const v = Math.min(15000, Math.max(800, Math.round(ms)))
    this.set({ hangoverMs: v })
  }

  /** 关掉「麦克风电平太低」提示 */
  dismissLowMic() {
    this.set({ lowMic: false })
  }

  /** 粘贴/修改原文。改完锚点会按记下的文字重新定位，进度不会白标 */
  setScript(script: string) {
    this.realign({
      script,
      scriptSource: script.trim() ? 'manual' : 'none',
    })
    // 存下来，刷新后优先用它（清空 = 删掉，下次回原文库）
    const fileName = this.state.fileName
    if (!this.deps.scriptEdits || !fileName) return
    if (script.trim()) this.deps.scriptEdits.set(fileName, script)
    else this.deps.scriptEdits.remove(fileName)
  }

  clearScript() {
    this.setScript('')
  }

  /** 这一篇的对齐输入：锚点 / 正文起点 / 平移都按文件名取，规则在 `core/scriptAlign` */
  private layout(
    script = this.state.script,
    chunks = this.state.chunks,
    fileName = this.state.fileName,
  ): ScriptLayout {
    return {
      script,
      chunks,
      anchors: this.cal.anchorsOf(fileName),
      textStartChunk: this.cal.startOf(fileName),
      offsetWords: this.cal.offsetOf(fileName),
    }
  }

  /** 当前的词表（空格切） */
  private wordList(script = this.state.script): string[] {
    return scriptWords(script)
  }

  /** 改完文本/块/锚点后统一重算：对齐结果 + 锚点范围 + 计数 */
  private realign(patch: Partial<SessionState> = {}) {
    const script = patch.script ?? this.state.script
    const chunks = patch.chunks ?? this.state.chunks
    const layout = this.layout(script, chunks)
    const ranges = resolveScriptAnchors(layout)
    this.set({
      ...patch,
      // 块变了（切块档位/撕开/合并），录音要按时间重新落到正确的块上
      takes: patch.takes ?? remapTakes(this.state.takes, chunks),
      manualAnchors: ranges.length,
      manualRanges: ranges,
      chunkEditCount: this.cal.editCountOf(this.state.fileName),
      splitPoints: this.cal.splitsOf(this.state.fileName),
      aligned: alignScript(layout),
    })
  }

  /**
   * 把「正文真正的开头」锚到第 k 块。
   * 用法：听到正文第一句是在第 k 块，就切到那一块按一下。
   */
  setTextStartChunk(k: number) {
    const n = this.state.chunks.length
    const v = n === 0 ? 0 : Math.min(Math.max(Math.round(k), 0), n - 1)
    this.cal.setStart(this.state.fileName, v)
    this.cal.persist(this.state.fileName)
    this.realign({ textStartChunk: v })
  }

  clearTextStart() {
    this.setTextStartChunk(0)
  }

  /**
   * 校准「文本和音频的时间差」：把词窗整体平移 n 个词。
   * 听到的比高亮靠后（高亮跟不上）就调大，高亮跑到前面去了就调小。
   * 按篇记住，换走再换回来还在。
   */
  setOffsetWords(n: number) {
    const total = this.wordList().length
    const v = Math.max(-total, Math.min(total, Math.round(n)))
    this.cal.setOffset(this.state.fileName, v)
    this.cal.persist(this.state.fileName)
    this.realign({ offsetWords: v })
  }

  nudgeOffsetWords(step: number) {
    this.setOffsetWords(this.state.offsetWords + step)
  }

  /**
   * 鼠标选字定块：把「当前这一块的音频」绑到原文的 [startWord, endWord) 上。
   * 重选就覆盖；冲突的旧锚点由对齐逻辑处理（细节在 state/anchorEditor）。
   */
  setAnchorWords(startWord: number, endWord: number) {
    if (this.anchors.setWords(startWord, endWord)) this.realign()
  }

  /**
   * 用快捷键/按钮微调当前块锚点的开头或结尾（夹在相邻锚点之间、至少留一个词的规则在
   * core/anchorEdits；没锚定时先按对齐结果钉一个，在 state/anchorEditor）。
   */
  nudgeAnchor(edge: 'start' | 'end', delta: number) {
    if (this.anchors.nudge(edge, delta)) this.realign()
  }

  /** 去掉当前块的锚点（其余锚点不动） */
  clearAnchorHere() {
    if (this.anchors.clearHere()) this.realign()
  }

  /** 清掉这一篇全部手动锚点，回到自动估计 */
  clearAnchors() {
    if (this.anchors.clearAll()) this.realign()
  }

  // ---- 手动撕开 / 合并块 ----
  //
  // VAD 碰到连续朗读会切出大块。这里在 VAD 结果上再叠一层手动边界，
  // 按音频时间记（和锚点一样），所以换「切块」档位后仍认。

  /** 解码后的单声道采样（给波形编辑用）。没加载时是空的 */
  audioSamples(): { samples: Float32Array; sampleRate: number } {
    return { samples: this.deps.player.samples, sampleRate: this.deps.player.sampleRate }
  }

  /** 在第 t 秒把当前块撕成两段（夹在块内、离两端留最小片段；锚点按刀口一分为二）。 */
  splitCurrentChunk(t: number) {
    this.edits.splitCurrent(t)
  }

  /** 把当前块和下一块合并（等于删掉两条之间的边界）。可以拿来撤销一次撕开 */
  mergeCurrentWithNext() {
    this.edits.mergeCurrentWithNext()
  }

  /** 清掉这一篇全部手动撕/合，回到纯 VAD 切块（这个必须重跑 VAD：要把刀口全丢掉） */
  resetChunkEdits() {
    this.edits.reset()
  }


  // ---- 麦克风 ----

  /** 采集参数（设备 / 原声优先）转给录音器。真实录音器在 start 前会读 */
  setMicOptions(opts: MicOptions) {
    this.deps.recorder.configure?.(opts)
  }

  /** 录音回放的额外放大倍数（1=不变，2=放大 100%），转给播放器 */
  setTakeBoost(mult: number) {
    this.deps.player.setTakeBoost?.(mult)
  }

  /**
   * 试录几秒并回放，只为听音色/排查发闷，不落盘、不占当前块的录音。
   */
  async testMic(ms = 2500): Promise<void> {
    await this.rec.test(ms)
  }

  // ---- 导航 ----

  /** 只改当前块，不播（点列表某一行的行为，规则在 playbackController）。 */
  select(index: number) {
    this.play.select(index)
  }

  next() {
    this.play.next()
  }

  prev() {
    this.play.prev()
  }

  private chunk(): Chunk | null {
    return this.state.chunks[this.state.current] ?? null
  }

  // ---- 播放 ----

  async playChunk(): Promise<void> {
    await this.play.playChunk()
  }

  /** 空格键：没在播就播，在播就暂停（连续跟读开着时整轮交给 CycleRunner） */
  async toggleChunkPlay(): Promise<void> {
    await this.play.toggleChunkPlay()
  }

  async playWhole(): Promise<void> {
    await this.play.playWhole()
  }

  /** 试听任意区间（波形刀口定位用），不碰当前块和播放状态 */
  auditionRange(start: number, end: number): Promise<void> {
    return this.play.auditionRange(start, end)
  }

  /** 停掉试听 */
  stopPreview(): void {
    this.play.stopPreview()
  }

  /** 参考音当前播到哪一秒（波形面板画进度线用） */
  playbackPosition(): number {
    return this.play.playbackPosition()
  }

  // ---- 连续跟读（可选） ----
  //
  // 打开后，空格键不再只是「播标准音」，而是跑一整轮：
  //   标准音 →（喘口气）→ 录音（按块长自动停）→ 回放刚才那条录音
  // 手动那条路：R 开始录音，再按 R 停录并自动回放。
  //
  // 这一轮的字段与「提前收尾」规则全在 `state/cycleRunner`（轮次号 / 录音定时器 /
  // 说过话没有…），这里只把 store 的能力递进去。

  /** 打开/关闭连续跟读（会先摸一下麦克风） */
  setAutoCycle(on: boolean): Promise<void> {
    return this.cycle.setEnabled(on)
  }

  /** 空格键在连续跟读模式下的行为 */
  runAutoCycle(): Promise<void> {
    return this.cycle.run()
  }

  abortCycle(): void {
    this.cycle.abort()
  }

  // ---- 录音 ----

  async startRecording(): Promise<void> {
    await this.rec.start()
  }

  /** 停止并保存；返回存下的那条（太短被丢掉时返回 null） */
  async stopRecording(): Promise<Take | null> {
    return this.rec.stop()
  }

  /** 放一条录音（会先把参考音/上一条停掉） */
  private playTake(take: Take): Promise<void> {
    this.deps.player.pause()
    return this.deps.player.playTake(take, this.state.rate)
  }

  /**
   * R 键。
   *
   * - 跟读一轮正在录音：R = 我读完了（跟空格在录音时一样）→ 停录 + 回放。
   * - 手动录音中：R = 停录 + **自动回放**刚录的这条（录完就能听）。
   * - 其它情况：R = 开始录音（若有一轮跟读在跑，先把它收掉，免得抢麦克风）。
   */
  async toggleRecording() {
    if (this.state.cycleStep === 'rec') {
      await this.cycle.stopThenPlayback()
      return
    }
    if (this.state.cycleStep !== 'idle') this.abortCycle()
    if (this.state.recording) {
      const saved = await this.stopRecording()
      if (saved) await this.playTake(saved)
    } else {
      await this.startRecording()
    }
  }

  takesFor(index: number): Take[] {
    return this.state.takes.filter((t) => t.chunkIndex === index)
  }

  async removeTake(id: string) {
    await this.deps.repo.remove(id)
    this.set({ takes: this.state.takes.filter((t) => t.id !== id) })
  }

  // ---- A/B 对比 ----

  /** 先播标准，再播我的。循环模式一直重复。 */
  async compareAB(loop: boolean): Promise<void> {
    const c = this.chunk()
    if (!c || this.state.abPlaying) return
    // A/B 会自己移动播放位置，旧的暂停点作废
    this.set({ abPlaying: true, pausedChunk: null })
    const gap = this.deps.abGapMs ?? 350

    do {
      this.deps.player.pause()
      await this.deps.player.playRange(c.start, c.end, this.state.rate)
      if (gap > 0) await sleep(gap)

      const mine = this.takesFor(c.index).at(-1)
      if (mine) {
        this.deps.player.pause()
        await this.deps.player.playTake(mine, this.state.rate)
        if (gap > 0) await sleep(gap)
      }
    } while (loop && this.state.abPlaying && this.state.chunks[this.state.current] === c)

    this.set({ abPlaying: false })
  }

  stopAb() {
    if (this.state.abPlaying) {
      this.set({ abPlaying: false })
      this.deps.player.pause()
    }
  }

  dispose() {
    this.stopAb()
    this.deps.player.release()
    this.deps.recorder.release()
  }
}

function sleep(ms: number) {
  return new Promise<void>((r) => setTimeout(r, ms))
}
