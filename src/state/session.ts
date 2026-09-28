import { detectSpeechSpans } from '../core/vad'
import { alignTextToChunks, type AlignedChunk } from '../core/alignText'
import {
  GRANULARITY_MS,
  type AudioPlayerPort,
  type Chunk,
  type Granularity,
  type RecorderPort,
  type ScriptRepoPort,
  type Take,
  type TakeRepoPort,
} from '../core/ports'

export interface SessionState {
  status: 'empty' | 'loading' | 'ready' | 'error'
  fileName: string
  duration: number
  chunks: Chunk[]
  current: number
  takes: Take[]
  granularity: Granularity
  rate: number
  recording: boolean
  /** 参考音是不是正在播（空格键的图标签要跟着变） */
  playing: boolean
  /** 连续跟读开关。关着的时候空格就是播放/暂停，一切照旧 */
  autoCycle: boolean
  /** 这一轮连续跟读走到哪一步了，UI 靠它显示状态 */
  cycleStep: 'idle' | 'ref' | 'rec' | 'compare'
  /** 自动录音会给多久，UI 上告诉用户「最多 N 秒」 */
  autoRecordMs: number
  /** 暂停时停在哪一块、停在哪一秒，用来「接着播」 */
  pausedChunk: number | null
  level: number
  abPlaying: boolean
  error: string | null
  /** 原文。优先用原文库自动带上的，没有才靠用户粘（T 键） */
  script: string
  /** script 是自动带的还是手动粘的，UI 上给个提示 */
  scriptSource: 'auto' | 'manual' | 'none'
  /** 原文库取到了没有。false = articles.json 没拿到，和「库里没这篇」要分开告诉用户 */
  scriptLibrary: boolean
  /** 文本相对音频的整体平移，单位是词。见 alignTextToChunks 的说明 */
  offsetWords: number
  /** 正文从哪一块开始。音频前面常有文本里没有的引子，标一下就不差这一截了 */
  textStartChunk: number
  /** script 按块摊开的结果，长度恒等于 chunks.length */
  aligned: AlignedChunk[]
}

const INITIAL: SessionState = {
  status: 'empty',
  fileName: '',
  duration: 0,
  chunks: [],
  current: 0,
  takes: [],
  granularity: 'normal',
  rate: 1,
  recording: false,
  playing: false,
  autoCycle: false,
  cycleStep: 'idle',
  autoRecordMs: 0,
  pausedChunk: null,
  level: 0,
  abPlaying: false,
  error: null,
  script: '',
  scriptSource: 'none',
  scriptLibrary: true,
  offsetWords: 0,
  textStartChunk: 0,
  aligned: [],
}

export interface SessionDeps {
  player: AudioPlayerPort
  recorder: RecorderPort
  repo: TakeRepoPort
  /** 原文库，可选。不给就等于没有自动带文本，只能手动粘 */
  scripts?: ScriptRepoPort
  /** A/B 两段之间的停顿 */
  abGapMs?: number
  /** 连续跟读里「标准音 → 录音」之间的停顿，留出切换状态的时间 */
  cycleGapMs?: number
  /** 说话声判定阈值（0..1 峰值）。低于它算没在说话 */
  voiceLevel?: number
  /** 说完之后静多久算「读完了」。太短会被句中的停顿切掉 */
  voiceHangoverMs?: number
}

/**
 * 连续跟读里标准音结束到开始录音之间留的空档。
 * 播音员速度和你自己的速度不一样，这半秒是给你换气、把嘴张开用的；
 * 不留的话录音开头永远是你的吸气声。
 */
const AUTO_CYCLE_GAP_MS = 600

/** 说话声判定阈值。室内底噪一般低于 0.02，说话峰值远高于 0.1 */
const VOICE_LEVEL = 0.06

/**
 * 说完之后静多久算「读完了」。
 * 1.6 秒是拿捏过的：正常句子之间的停顿不到 1 秒，
 * 但跟读时想一下再开口可能超过 1 秒，所以留宽一点。
 * 判断只影响「什么时候进对比」，判断错了最坏情况是等满兜底时长，不会丢录音。
 */
const VOICE_HANGOVER_MS = 1600

/** 兜底：静音检测要是失灵（麦没声、底噪太高），最多录这么久 */
function recordCapMs(chunkSec: number): number {
  return Math.min(90000, Math.max(4000, Math.round(chunkSec * 2000 + 3000)))
}

/**
 * ViewModel。不依赖 React，所以可以直接单测。
 * React 通过 useSyncExternalStore 订阅。
 */
export class SessionStore {
  private state: SessionState = INITIAL
  private listeners = new Set<() => void>()
  private generation = 0 // load 竞态守卫
  /** 每篇的平移量单独记着，换文件再换回来不用重调 */
  private offsets = new Map<string, number>()
  /** 每篇的正文起始块 */
  private starts = new Map<string, number>()
  /** 连续跟读的轮次号：中途改主意时靠它让跑着的那一轮自己退出 */
  private cycleGen = 0
  private recordTimer: ReturnType<typeof setInterval> | null = null
  /** 这一轮录音里说过话没有 / 最后一次说话的时刻（判断「读完了」用） */
  private speechSeen = false
  private lastVoiceAt = 0
  private recStartedAt = 0

  constructor(private deps: SessionDeps) {
    this.deps.recorder.onLevel((v) => {
      // 顺便拿它判断「说完没有」：连续跟读靠这个自动结束录音
      if (this.state.recording && v > (this.deps.voiceLevel ?? VOICE_LEVEL)) {
        this.speechSeen = true
        this.lastVoiceAt = Date.now()
      }
      this.set({ level: v })
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

      const takes = await this.deps.repo.list()
      if (gen !== this.generation) return

      const chunks = this.derive(
        this.deps.player.samples,
        this.deps.player.sampleRate,
        this.state.granularity,
      )

      // 换文件意味着换文章，旧的原文留着只会误导，先清掉，
      // 然后按文件名从原文库里找这一篇，找到就直接摊到块上。
      const found = await this.deps.scripts?.find(fileName)
      if (gen !== this.generation) return
      const script = found?.text ?? ''

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
        scriptSource: script ? 'auto' : 'none',
        scriptLibrary: found?.library ?? false,
        offsetWords: this.offsets.get(fileName) ?? 0,
        textStartChunk: this.starts.get(fileName) ?? 0,
        aligned: this.align(script, chunks, fileName),
      })
    } catch (e) {
      if (gen !== this.generation) return
      this.set({ status: 'error', error: e instanceof Error ? e.message : String(e) })
    }
  }

  private derive(samples: Float32Array, sampleRate: number, g: Granularity): Chunk[] {
    if (samples.length === 0 || sampleRate === 0) return []
    return detectSpeechSpans(samples, sampleRate, {
      mergeGapMs: GRANULARITY_MS[g],
      minSpeechMs: 200,
    }).map((s, index) => ({ index, start: s.start, end: s.end }))
  }

  setGranularity(g: Granularity) {
    if (g === this.state.granularity || this.state.status !== 'ready') return
    const chunks = this.derive(this.deps.player.samples, this.deps.player.sampleRate, g)
    this.set({
      granularity: g,
      chunks,
      current: Math.min(this.state.current, Math.max(0, chunks.length - 1)),
      // 块变了，对齐要跟着重算
      aligned: this.align(this.state.script, chunks),
    })
  }

  setRate(rate: number) {
    this.set({ rate })
  }

  /** 粘贴/修改原文 */
  setScript(script: string) {
    this.set({
      script,
      scriptSource: script.trim() ? 'manual' : 'none',
      aligned: this.align(script, this.state.chunks),
    })
  }

  clearScript() {
    this.setScript('')
  }

  private align(script: string, chunks: Chunk[], fileName = this.state.fileName): AlignedChunk[] {
    if (!script.trim()) return []
    // 音频前面可能有文本里没有的引子（播报员的开场之类），
    // 那样第一句正文其实出现在第 k 块。标了就从第 k 块开始摊词，
    // 前面的块空着 —— 词一个不丢，而且摊的区间更贴近真实朗读区间。
    const n = chunks.length
    const skip = n === 0 ? 0 : Math.min(Math.max(this.starts.get(fileName) ?? 0, 0), n - 1)
    const head: AlignedChunk[] = chunks.slice(0, skip).map((c) => ({
      index: c.index,
      text: '',
      wordRange: [0, 0] as [number, number],
    }))
    return [...head, ...alignTextToChunks(script, chunks.slice(skip), this.offsets.get(fileName) ?? 0)]
  }

  /**
   * 把「正文真正的开头」锚到第 k 块。
   * 用法：听到正文第一句是在第 k 块，就切到那一块按一下。
   */
  setTextStartChunk(k: number) {
    const n = this.state.chunks.length
    const v = n === 0 ? 0 : Math.min(Math.max(Math.round(k), 0), n - 1)
    this.starts.set(this.state.fileName, v)
    this.set({
      textStartChunk: v,
      aligned: this.align(this.state.script, this.state.chunks),
    })
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
    const total = this.state.script.trim().split(/\s+/).filter(Boolean).length
    const v = Math.max(-total, Math.min(total, Math.round(n)))
    this.offsets.set(this.state.fileName, v)
    this.set({
      offsetWords: v,
      aligned: this.align(this.state.script, this.state.chunks),
    })
  }

  nudgeOffsetWords(step: number) {
    this.setOffsetWords(this.state.offsetWords + step)
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
   * 切块并直接把这一块播出来。上一块/下一块用它。
   * 挪过去就该能听到，不用再多按一次空格 —— 跟读的循环是「听→录→比→下一块」，
   * 中间插一步手动播放就断了。
   */
  private async selectAndPlay(index: number): Promise<void> {
    if (index < 0 || index >= this.state.chunks.length) return
    if (index === this.state.current) return   // 已经在边界上，别重放
    this.select(index)
    // 录音时不能放参考音，会被麦克风录进去
    if (this.state.recording) return
    await this.playChunk()
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

  // ---- 连续跟读（可选） ----
  //
  // 打开后，空格键不再只是「播标准音」，而是跑一整轮：
  //   标准音 →（喘口气）→ 录音（按块长自动停）→ 对比（标准 → 我的）
  // 手动那条路完全不动：R 还是只管录音，空格在没开这个模式时还是播放/暂停。
  //
  // 两个都能提前收：
  //   · 录音中按空格 = 我读完了，直接去对比（不用等自动停）
  //   · 标准音/对比中按空格 = 中止这一轮

  /**
   * 自动录音该录多久 —— 这只是**兜底上限**。
   * 正常情况下不用等满：说完停下 1.6 秒（VOICE_HANGOVER_MS）就自动结束进对比了。
   * 上限给得宽是因为学习者比播音员慢，宁可多留也不能把人读一半掐掉。
   */
  private recordCapMs(chunkSec: number): number {
    return recordCapMs(chunkSec)
  }

  /** 打开/关闭连续跟读。打开时先摸一下麦克风，免得走到录音那步才发现没权限 */
  async setAutoCycle(on: boolean): Promise<void> {
    this.abortCycle()
    this.set({ autoCycle: on })
    if (!on) return
    try {
      await this.deps.recorder.start()
      await this.deps.recorder.stop() // 只为了触发权限/设备初始化，这段不留
      this.set({ error: null })
    } catch (e) {
      this.set({
        autoCycle: false,
        error: `麦克风打不开（${e instanceof Error ? e.message : String(e)}），连续跟读没打开`,
      })
    }
  }

  /** 空格键在连续跟读模式下的行为 */
  async runAutoCycle(): Promise<void> {
    if (this.state.cycleStep === 'rec') {
      // 录音中按 = 我读完了，去对比
      await this.stopRecordingThenCompare()
      return
    }
    if (this.state.cycleStep !== 'idle') {
      this.abortCycle()
      return
    }
    const c = this.chunk()
    if (!c) return
    const gen = ++this.cycleGen
    this.stopAb()

    this.set({ cycleStep: 'ref', playing: true, pausedChunk: null })
    await this.deps.player.playRange(c.start, c.end, this.state.rate)
    this.set({ playing: false })
    if (gen !== this.cycleGen) return

    await sleep(this.deps.cycleGapMs ?? AUTO_CYCLE_GAP_MS)
    if (gen !== this.cycleGen) return

    await this.startRecording()
    if (gen !== this.cycleGen || !this.state.recording) {
      this.set({ cycleStep: 'idle' })
      return
    }

    const ms = this.recordCapMs(Math.max(0, c.end - c.start))
    this.speechSeen = false
    this.recStartedAt = Date.now()
    this.lastVoiceAt = this.recStartedAt
    this.set({ cycleStep: 'rec', autoRecordMs: ms })
    // 每 200ms 看一次：说完静了一会儿就收工；一直没动静（或一直在说）就等兜底上限
    const hangover = this.deps.voiceHangoverMs ?? VOICE_HANGOVER_MS
    this.recordTimer = setInterval(() => {
      const now = Date.now()
      const silentFor = now - this.lastVoiceAt
      const elapsed = now - this.recStartedAt
      if ((this.speechSeen && silentFor > hangover) || elapsed > ms) {
        this.clearRecordTimer()
        void this.stopRecordingThenCompare()
      }
    }, 200)
  }

  /** 停了录音、存下来，然后接着对比（连续跟读的第 3 步） */
  private async stopRecordingThenCompare(): Promise<void> {
    this.clearRecordTimer()
    await this.stopRecording()
    if (this.state.cycleStep !== 'rec') {
      this.set({ cycleStep: 'idle' })
      return
    }
    const gen = this.cycleGen
    this.set({ cycleStep: 'compare' })
    await this.compareAB(false)
    if (gen === this.cycleGen) this.set({ cycleStep: 'idle' })
  }

  abortCycle() {
    this.cycleGen++ // 让还在跑的那一轮自己退出
    this.clearRecordTimer()
    if (this.state.recording) void this.stopRecording()
    this.deps.player.pause()
    this.stopAb()
    if (this.state.cycleStep !== 'idle' || this.state.playing) {
      this.set({ cycleStep: 'idle', playing: false })
    }
  }

  private clearRecordTimer() {
    if (this.recordTimer !== null) {
      clearInterval(this.recordTimer)
      this.recordTimer = null
    }
  }

  // ---- 录音 ----

  async startRecording(): Promise<void> {
    if (this.state.recording || !this.chunk()) return
    this.deps.player.pause()
    this.stopAb()
    try {
      await this.deps.recorder.start()
      this.set({ recording: true })
    } catch (e) {
      this.set({ error: e instanceof Error ? e.message : String(e) })
    }
  }

  async stopRecording(): Promise<void> {
    if (!this.state.recording) return
    this.clearRecordTimer()
    this.set({ recording: false, level: 0 })
    const take = await this.deps.recorder.stop()
    if (take.durationSec < 0.2) return // 手滑了

    const record: Take = {
      id: crypto.randomUUID(),
      chunkIndex: this.state.current,
      mimeType: take.mimeType,
      durationSec: take.durationSec,
      createdAt: Date.now(),
      blob: take.blob,
    }
    await this.deps.repo.save(record)
    this.set({ takes: [...this.state.takes, record] })
  }

  async toggleRecording() {
    // 手动录音是自己一条路，走它就把连续跟读那一轮停掉，免得两边抢麦克风
    if (this.state.cycleStep !== 'idle') this.abortCycle()
    if (this.state.recording) await this.stopRecording()
    else await this.startRecording()
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
