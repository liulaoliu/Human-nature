import { detectSpeechSpans } from '../core/vad'
import { applyChunkEdits, MIN_PIECE_SEC } from '../core/chunkEdits'
import { addSplit, editCount, mergeAt, type ChunkEditLog } from '../core/chunkEditLog'
import { latestTakePerChunk, remapTakes } from '../core/takeChunk'
import { alignScript, resolveScriptAnchors, scriptWords, type ScriptLayout } from '../core/scriptAlign'
import { AUTO_CYCLE_GAP_MS, NOISE_FLOOR_INIT, VOICE_LEVEL, voiceThreshold } from '../core/recording'
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
import { recordLocalActivity } from './localActivity'
import { INITIAL, type SessionDeps, type SessionState } from './sessionConfig'

export type { SessionDeps, SessionState } from './sessionConfig'

/**
 * ViewModel。不依赖 React，所以可以直接单测。
 * React 通过 useSyncExternalStore 订阅。
 *
 * 这一层只做**编排**：状态机、播放/录音的时序、竞态守卫。
 * 三块容易膨胀的逻辑已经各归各位：
 * - 每篇的手动校准（平移/起点/锚点/撕合）→ `state/calibrationLedger`
 * - 「原文怎么摊到块上」的规则 → `core/scriptAlign`
 * - 录音与块的对应、判定阈值与兜底时长 → `core/takeChunk` / `core/recording`
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
  /** 噪声底：录音期间见过的最低电平，用来自适应说话阈值（不同麦克风增益差很多） */
  private noiseFloor = NOISE_FLOOR_INIT
  /** 这次录音见过的最高电平，用完判断「麦克风是不是太小声」 */
  private recPeak = 0
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
    this.deps.recorder.onLevel((v) => {
      if (this.state.recording) {
        if (v > this.recPeak) this.recPeak = v
        // 噪声底只取「见过的最低电平」，单调不增 —— 连续朗读时也不会被自己的语音抬高
        if (v < this.noiseFloor) this.noiseFloor = v
        const thr = voiceThreshold(this.noiseFloor, this.deps.voiceLevel ?? VOICE_LEVEL)
        this.cycle.noteLevel(v, thr)
      }
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

  /** 这一篇记过的撕/合（账本形状 → core 认的 `ChunkEditLog`） */
  private editLog(): ChunkEditLog {
    return {
      splits: this.cal.splitsOf(this.state.fileName),
      merges: this.cal.mergesOf(this.state.fileName),
    }
  }

  private applyEditLog(log: ChunkEditLog): void {
    this.cal.setSplits(this.state.fileName, log.splits)
    this.cal.setMerges(this.state.fileName, log.merges)
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
    this.rederive({ granularity: g })
  }

  /** 重跑 VAD + 手动撕合，然后把 current 夹进新块数里，再重算对齐 */
  private rederive(patch: Partial<SessionState> = {}): void {
    const g = patch.granularity ?? this.state.granularity
    const chunks = this.derive(this.deps.player.samples, this.deps.player.sampleRate, g)
    const current = Math.min(patch.current ?? this.state.current, Math.max(0, chunks.length - 1))
    this.realign({ ...patch, chunks, current })
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

  /**
   * 在第 t 秒把当前块撕成两段。t 会被夹进当前块、并离两端留出最小片段。
   * 如果当前块有手动锚点，锚点按刀口比例一分为二 —— 不拆的话后半块会显示出
   * 下一块的文字，更乱；拆开后用户可以再各自微调。
   */
  splitCurrentChunk(t: number) {
    const c = this.chunk()
    if (!c) return
    const lo = c.start + MIN_PIECE_SEC
    const hi = c.end - MIN_PIECE_SEC
    if (hi <= lo) return
    const at = Math.min(Math.max(t, lo), hi)
    const fileName = this.state.fileName

    // 「撕 = 抵消合并」「同一刀口不重复记」都在 core/chunkEditLog（有测试）
    const next = addSplit(this.editLog(), at)
    if (!next) return
    this.applyEditLog(next)

    this.anchors.splitAtStart(c, at)
    this.cal.persist(fileName)
    this.rederiveFromEdits()
  }

  /**
   * 把一次手动切分（撕/合）应用到**现有**块上，不重跑 VAD。
   *
   * 之前每次都 `detect()` 重跑一遍：长 Briefing 约 350ms，连着撕十几刀就是好几秒等待，
   * 而这些刀口都是毫秒级的交互，延迟直接顶在手上。
   *
   * `applyChunkEdits` 对已经存在的边界是幂等的（切点正好落在已有边界上时，
   * 两侧都不满足最小片段、不产生新切点），所以在「已经切好的块」上重复套用安全。
   */
  private applyEditsToCurrent(): Chunk[] {
    return applyChunkEdits(
      this.state.chunks,
      this.cal.splitsOf(this.state.fileName),
      this.cal.mergesOf(this.state.fileName),
    )
  }

  /**
   * 「撕开」之后的重算：块 = 现有块 + 刀口，然后重跑对齐。
   *
   * 只在**新增刀口**时能用这个快路径。**合并/撤销不行**：把一条 split 从列表里
   * 删掉，并不会让已经切开的两半重新合上（`applyChunkEdits` 只负责加切点、
   * 和删「起点等于某时间」的边界，而撤销之后那条边界已经不在切点列表里了）。
   * 所以 merge/reset 仍走完整重算 —— 它们是低频的纠错操作，代价可以接受。
   */
  private rederiveFromEdits(): void {
    const chunks = this.applyEditsToCurrent()
    this.realign({
      chunks,
      current: Math.min(this.state.current, Math.max(0, chunks.length - 1)),
    })
  }

  /** 把当前块和下一块合并（等于删掉两条之间的边界）。可以拿来撤销一次撕开 */
  mergeCurrentWithNext() {
    const c = this.chunk()
    const next = this.state.chunks[this.state.current + 1]
    if (!c || !next) return
    const boundary = next.start
    const fileName = this.state.fileName

    // 「合并 = 撤销撕开」的规则在 core/chunkEditLog（有测试）
    this.applyEditLog(mergeAt(this.editLog(), boundary))
    this.anchors.joinAcross(boundary)
    this.cal.persist(fileName)
    this.rederive() // 撤销要真正合上两半，必须从 VAD 结果重算（见 rederiveFromEdits）
  }

  /** 清掉这一篇全部手动撕/合，回到纯 VAD 切块（这个必须重跑 VAD：要把刀口全丢掉） */
  resetChunkEdits() {
    const fileName = this.state.fileName
    if (editCount(this.editLog()) === 0) return
    this.cal.clearEdits(fileName)
    this.cal.persist(fileName)
    this.rederive()
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
    if (this.state.recording || this.state.status !== 'ready') return
    this.abortCycle()
    this.deps.player.pause()
    try {
      await this.deps.recorder.start()
    } catch (e) {
      this.set({ error: e instanceof Error ? e.message : String(e) })
      return
    }
    this.set({ recording: true, level: 0 })
    await sleep(ms)
    const t = await this.deps.recorder.stop()
    this.set({ recording: false, level: 0 })
    if (t.durationSec < 0.2) return
    await this.playTake({
      id: crypto.randomUUID(),
      fileName: this.state.fileName,
      chunkIndex: -1,
      mimeType: t.mimeType,
      durationSec: t.durationSec,
      createdAt: Date.now(),
      blob: t.blob,
    })
  }

  // ---- 导航 ----

  /**
   * 只改当前块，不播。列表里点某一行用它 ——
   * 点一下未必是想听，可能只是想看看这块的文字和时间。
   */
  select(index: number) {
    if (index < 0 || index >= this.state.chunks.length) return
    this.stopAb()
    // 换块了：上次的暂停位置不算数，正在跑的那一轮也别继续了
    if (this.state.cycleStep !== 'idle') this.abortCycle()
    this.set({ current: index, pausedChunk: null })
  }

  /**
   * 切块并直接跑「空格键那一套」。上一块/下一块用它。
   * 挪过去就当你按了空格：没开连续跟读就是播标准音，开了就跑一整圈。
   * 这样手动按 ↓ 和按空格是同一个入口，不会有两套行为。
   */
  private async selectAndPlay(index: number): Promise<void> {
    if (index < 0 || index >= this.state.chunks.length) return
    if (index === this.state.current) return   // 已经在边界上，别重放
    this.select(index)
    // 录音时不能放参考音，会被麦克风录进去
    if (this.state.recording) return
    // 上一块可能还在播：先停干净，免得空格那条路看到 playing=true 反而去暂停
    if (this.state.playing) {
      this.deps.player.pause()
      this.set({ playing: false })
    }
    await this.toggleChunkPlay()
  }

  next() {
    void this.selectAndPlay(this.state.current + 1)
  }

  prev() {
    void this.selectAndPlay(this.state.current - 1)
  }

  private chunk(): Chunk | null {
    return this.state.chunks[this.state.current] ?? null
  }

  // ---- 播放 ----

  async playChunk(): Promise<void> {
    const c = this.chunk()
    if (!c) return
    this.stopAb()
    // 暂停过（而且是同一块）就接着播，否则从头 —— 否则「暂停再播」等于重播
    const p = this.deps.player.position
    const resumable =
      this.state.pausedChunk === c.index && p > c.start + 0.05 && p < c.end - 0.15
    this.set({ playing: true, pausedChunk: null })
    try {
      await this.deps.player.playRange(resumable ? p : c.start, c.end, this.state.rate)
    } finally {
      // 播完（或在别处被 pause 掉）都要把状态收回来，不然按钮一直显示「暂停」
      this.set({ playing: false })
    }
  }

  /**
   * 空格键：没在播就播，在播就暂停。
   * 暂停会记住位置和是哪一块，所以再按一下是**接着**播，不是从头重来。
   */
  async toggleChunkPlay(): Promise<void> {
    if (this.state.autoCycle) {
      await this.runAutoCycle()
      return
    }
    if (this.state.playing) {
      this.deps.player.pause()
      this.set({ playing: false, pausedChunk: this.state.current })
      return
    }
    await this.playChunk()
  }

  async playWhole(): Promise<void> {
    this.stopAb()
    // 整篇连播会把位置带到别处，之前那个「暂停点」就不再是暂停点了
    this.set({ pausedChunk: null })
    await this.deps.player.playWhole(this.state.rate)
  }

  /** 试听任意区间（波形刀口定位用），不碰当前块和播放状态 */
  auditionRange(start: number, end: number): Promise<void> {
    this.deps.player.pause()
    return this.deps.player.playRange(start, end, this.state.rate)
  }

  /** 停掉试听 */
  stopPreview(): void {
    this.deps.player.pause()
  }

  /** 参考音当前播到哪一秒（波形面板画进度线用） */
  playbackPosition(): number {
    return this.deps.player.position
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
    if (this.state.recording || !this.chunk()) return
    this.deps.player.pause()
    this.stopAb()
    try {
      await this.deps.recorder.start()
      this.noiseFloor = NOISE_FLOOR_INIT
      this.recPeak = 0
      this.level.resetThrottle() // 让第一帧电平立刻进 state
      this.set({ recording: true })
    } catch (e) {
      this.set({ error: e instanceof Error ? e.message : String(e) })
    }
  }

  /** 停止并保存；返回存下的那条（太短被丢掉时返回 null） */
  async stopRecording(): Promise<Take | null> {
    if (!this.state.recording) return null
    const c = this.chunk()
    this.set({ recording: false, level: 0 })
    this.level.flush(0) // 电平归零 + 清掉可能还挂着的节流定时器
    const take = await this.deps.recorder.stop()
    if (take.durationSec < 0.2) return null // 手滑了

    // 峰值太低多半是麦克风增益没调起来：提示去系统里调大（别让它一直又小又难判定）
    this.set({ lowMic: this.recPeak < 0.03 })

    const record: Take = {
      id: crypto.randomUUID(),
      fileName: this.state.fileName,
      chunkIndex: this.state.current,
      // 记下参考音的时间区间：块号会变（切块档位/手动撕开），时间不会
      startSec: c?.start,
      endSec: c?.end,
      mimeType: take.mimeType,
      durationSec: take.durationSec,
      createdAt: Date.now(),
      blob: take.blob,
    }
    // 旧录音不留：同一块只保留最新的一条，够「复读」用就行，
    // 不然一遍遍练下来会堆一大堆没用的历史。别的块不动。
    const stale = this.state.takes.filter((t) => t.chunkIndex === record.chunkIndex)
    for (const t of stale) await this.deps.repo.remove(t.id)
    await this.deps.repo.save(record)
    recordLocalActivity('speak')
    this.set({
      takes: [...this.state.takes.filter((t) => t.chunkIndex !== record.chunkIndex), record],
    })
    return record
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
