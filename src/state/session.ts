import { detectSpeechSpans } from '../core/vad'
import { applyChunkEdits, MIN_PIECE_SEC } from '../core/chunkEdits'
import { resolveTakeChunk } from '../core/takeChunk'
import {
  alignTextToChunks,
  alignTextToChunksWithAnchors,
  resolveAnchors,
  type AlignedChunk,
  type ResolvedAnchor,
} from '../core/alignText'
import {
  GRANULARITY_MS,
  type AudioPlayerPort,
  type CalibrationRepoPort,
  type Chunk,
  type Granularity,
  type ManualAnchor,
  type MicOptions,
  type RecorderPort,
  type ScriptEditRepoPort,
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
  cycleStep: 'idle' | 'ref' | 'rec' | 'playback'
  /** 自动录音会给多久，UI 上告诉用户「最多 N 秒」 */
  autoRecordMs: number
  /** 说完之后静多少毫秒算「读完了」。可调：读得慢/常有停顿的人需要更长 */
  hangoverMs: number
  /** 暂停时停在哪一块、停在哪一秒，用来「接着播」 */
  pausedChunk: number | null
  level: number
  abPlaying: boolean
  error: string | null
  /** 这次录音的输入峰值太低（麦克风增益没调起来），UI 提示去系统设置调大 */
  lowMic: boolean
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
  /** 鼠标选字手动锚定了多少块。>0 时 offsetWords/textStartChunk 让位给锚点 */
  manualAnchors: number
  /** 手动锚点解析到当前文本后的词范围（UI 用来标开头结尾） */
  manualRanges: ResolvedAnchor[]
  /** 手动撕开/合并了几处（>0 时 UI 显示「已手动切分」和重置入口） */
  chunkEditCount: number
  /** 手动撕开的时间点（秒），UI 在左侧列表标出这些新边界 */
  splitPoints: number[]
  /** script 按块摊开的结果，长度恒等于 chunks.length */
  aligned: AlignedChunk[]
}

/**
 * 说完之后静多久算「读完了」。
 * 默认 2.5 秒：正常句子之间的停顿不到 1 秒，但跟读时想一下再开口、
 * 或者读得慢/句中有停顿的人，都可能超过 1.6 秒；这个值可以在界面上调。
 * 判断错了最坏情况只是等满兜底时长，不会丢录音。
 */
const VOICE_HANGOVER_MS = 2500

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
  hangoverMs: VOICE_HANGOVER_MS,
  pausedChunk: null,
  level: 0,
  abPlaying: false,
  error: null,
  lowMic: false,
  script: '',
  scriptSource: 'none',
  scriptLibrary: true,
  offsetWords: 0,
  textStartChunk: 0,
  manualAnchors: 0,
  manualRanges: [],
  chunkEditCount: 0,
  splitPoints: [],
  aligned: [],
}

export interface SessionDeps {
  player: AudioPlayerPort
  recorder: RecorderPort
  repo: TakeRepoPort
  /** 原文库，可选。不给就等于没有自动带文本，只能手动粘 */
  scripts?: ScriptRepoPort
  /** 手动改过的正文的持久化，可选。不给就只记在内存里，刷新回原文库 */
  scriptEdits?: ScriptEditRepoPort
  /** 手动校准（文字偏移 / 正文起点）的持久化，可选。不给就只记在内存里 */
  calibration?: CalibrationRepoPort
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

/**
 * 说话判定的**绝对下限**（真·安静房间的底噪也不该触发它）。
 * 实际阈值 = max(下限, 噪声底 + 余量)，见 VOICE_MARGIN。
 */
const VOICE_LEVEL = 0.006

/** 比噪声底高多少算在说话。用「加」不用「乘」，避免连续朗读时阈值被自己抬高 */
const VOICE_MARGIN = 0.008

/** 每次开录时给噪声底的初值；随后只取「见过的最低电平」（单调不增） */
const NOISE_FLOOR_INIT = 0.005

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
  /** 每篇的手动锚点（鼠标选字定下来的） */
  private anchors = new Map<string, ManualAnchor[]>()
  /** 每篇手动撕开的时间点（秒） */
  private splits = new Map<string, number[]>()
  /** 每篇手动合并的边界时间（秒，记的是「被并进上一块」那块的起点） */
  private merges = new Map<string, number[]>()
  /** 连续跟读的轮次号：中途改主意时靠它让跑着的那一轮自己退出 */
  private cycleGen = 0
  private recordTimer: ReturnType<typeof setInterval> | null = null
  /** 这一轮录音里说过话没有 / 最后一次说话的时刻（判断「读完了」用） */
  private speechSeen = false
  private lastVoiceAt = 0
  private recStartedAt = 0
  /** 噪声底：录音期间见过的最低电平，用来自适应说话阈值（不同麦克风增益差很多） */
  private noiseFloor = NOISE_FLOOR_INIT
  /** 这次录音见过的最高电平，用完判断「麦克风是不是太小声」 */
  private recPeak = 0

  constructor(private deps: SessionDeps) {
    this.deps.recorder.onLevel((v) => {
      // 顺便拿它判断「说完没有」：连续跟读靠这个自动结束录音
      if (this.state.recording) {
        if (v > this.recPeak) this.recPeak = v
        // 噪声底只取「见过的最低电平」，单调不增 —— 连续朗读时也不会被自己的语音抬高
        if (v < this.noiseFloor) this.noiseFloor = v
        const thr = Math.max(this.deps.voiceLevel ?? VOICE_LEVEL, this.noiseFloor + VOICE_MARGIN)
        if (v > thr) {
          this.speechSeen = true
          this.lastVoiceAt = Date.now()
        }
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

      // 只取这一篇的录音。块号是从 0 开始的，不筛的话别的文章的录音会串进来
      // （老记录没有 fileName，会一并被筛掉——那些本来也分不清是哪篇的）
      const all = (await this.deps.repo.list()).filter((t) => t.fileName === fileName)
      if (gen !== this.generation) return

      // 把上次存的校准（文字偏移 / 正文起点 / 手动锚点 / 手动撕合）读回来，刷新页面不丢
      const saved = this.deps.calibration?.get(fileName)
      if (saved) {
        this.offsets.set(fileName, saved.offsetWords)
        this.starts.set(fileName, saved.textStartChunk)
        if (saved.anchors) this.anchors.set(fileName, saved.anchors)
        if (saved.splits?.length) this.splits.set(fileName, saved.splits)
        if (saved.merges?.length) this.merges.set(fileName, saved.merges)
      }

      const chunks = this.derive(
        this.deps.player.samples,
        this.deps.player.sampleRate,
        this.state.granularity,
        fileName,
      )

      // 录音挂到「现在」的块上：块号会变（切块档位、手动撕开），按音频时间找块
      const takes = this.pickLatestPerChunk(this.remapTakes(all, chunks))
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
      const ranges = this.resolveRanges(script, chunks, fileName)

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
        offsetWords: this.offsets.get(fileName) ?? 0,
        textStartChunk: this.starts.get(fileName) ?? 0,
        manualAnchors: ranges.length,
        manualRanges: ranges,
        chunkEditCount: this.editCount(fileName),
        splitPoints: this.splits.get(fileName) ?? [],
        aligned: this.align(script, chunks, fileName),
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
    return applyChunkEdits(base, this.splits.get(fileName) ?? [], this.merges.get(fileName) ?? [])
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

  private align(script: string, chunks: Chunk[], fileName = this.state.fileName): AlignedChunk[] {
    if (!script.trim()) return []
    // 有手动锚点就以锚点为准（鼠标选字那条路）—— 比估的准，offset/起点让位
    const anchors = this.anchors.get(fileName) ?? []
    if (anchors.length > 0) return alignTextToChunksWithAnchors(script, chunks, anchors)
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

  /** 当前的词表（空格切） */
  private wordList(script = this.state.script): string[] {
    return script.trim() ? script.trim().split(/\s+/).filter(Boolean) : []
  }

  /** 把锚点解析到当前文本/块上，得到「第几块对应哪几个词」 */
  private resolveRanges(
    script: string,
    chunks: Chunk[],
    fileName = this.state.fileName,
  ): ResolvedAnchor[] {
    const anchors = this.anchors.get(fileName) ?? []
    if (anchors.length === 0 || chunks.length === 0) return []
    const words = this.wordList(script)
    if (words.length === 0) return []
    return resolveAnchors(words, chunks, anchors)
  }

  /** 改完文本/块/锚点后统一重算：对齐结果 + 锚点范围 + 计数 */
  private realign(patch: Partial<SessionState> = {}) {
    const script = patch.script ?? this.state.script
    const chunks = patch.chunks ?? this.state.chunks
    const ranges = this.resolveRanges(script, chunks)
    this.set({
      ...patch,
      // 块变了（切块档位/撕开/合并），录音要按时间重新落到正确的块上
      takes: patch.takes ?? this.remapTakes(this.state.takes, chunks),
      manualAnchors: ranges.length,
      manualRanges: ranges,
      chunkEditCount: this.editCount(),
      splitPoints: this.splits.get(this.state.fileName) ?? [],
      aligned: this.align(script, chunks),
    })
  }

  /** 把录音的块号按「现在」的块重算（块号会变，音频时间不会） */
  private remapTakes(takes: Take[], chunks: Chunk[]): Take[] {
    if (takes.length === 0) return takes
    return takes.map((t) => {
      const idx = resolveTakeChunk(t, chunks)
      return t.chunkIndex === idx ? t : { ...t, chunkIndex: idx }
    })
  }

  /** 每块只留最新一条。老版本给同一块堆了好几条时，多余的会在 load 时清掉 */
  private pickLatestPerChunk(takes: Take[]): Take[] {
    const latest = new Map<number, Take>()
    for (const t of takes) {
      const prev = latest.get(t.chunkIndex)
      if (!prev || t.createdAt >= prev.createdAt) latest.set(t.chunkIndex, t)
    }
    return [...latest.values()].sort((a, b) => a.createdAt - b.createdAt)
  }

  /** 这一篇手动撕/合了几处 */
  private editCount(fileName = this.state.fileName): number {
    return (this.splits.get(fileName)?.length ?? 0) + (this.merges.get(fileName)?.length ?? 0)
  }

  /**
   * 把「正文真正的开头」锚到第 k 块。
   * 用法：听到正文第一句是在第 k 块，就切到那一块按一下。
   */
  setTextStartChunk(k: number) {
    const n = this.state.chunks.length
    const v = n === 0 ? 0 : Math.min(Math.max(Math.round(k), 0), n - 1)
    this.starts.set(this.state.fileName, v)
    this.persistCalibration()
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
    this.offsets.set(this.state.fileName, v)
    this.persistCalibration()
    this.realign({ offsetWords: v })
  }

  nudgeOffsetWords(step: number) {
    this.setOffsetWords(this.state.offsetWords + step)
  }

  /**
   * 鼠标选字定块：把「当前这一块的音频」绑到原文的 [startWord, endWord) 上。
   * 同时记下这段文字，改文本后靠它在新词表里重新定位。
   * 同一个时刻只留一个锚点，重选就覆盖；冲突的旧锚点由对齐逻辑处理。
   */
  setAnchorWords(startWord: number, endWord: number) {
    const c = this.chunk()
    if (!c) return
    const s = Math.min(startWord, endWord)
    const e = Math.max(startWord, endWord)
    if (e <= s) return
    const words = this.wordList()
    const fileName = this.state.fileName
    const kept = (this.anchors.get(fileName) ?? []).filter(
      (a) => Math.abs(a.atSec - c.start) > 1e-6,
    )
    this.anchors.set(fileName, [
      ...kept,
      { atSec: c.start, startWord: s, endWord: e, text: words.slice(s, e).join(' ') },
    ])
    this.persistCalibration()
    this.realign()
  }

  /**
   * 用快捷键/按钮微调当前块锚点的开头或结尾。
   * 当前块还没锚定的话，先按现在的对齐结果钉一个，再挪。
   * 夹在相邻锚点之间，保证词范围仍然有序不重叠。
   */
  nudgeAnchor(edge: 'start' | 'end', delta: number) {
    const c = this.chunk()
    if (!c) return
    const words = this.wordList()
    const total = words.length
    if (total === 0) return

    const fileName = this.state.fileName
    const list = [...(this.anchors.get(fileName) ?? [])]
    if (!list.some((a) => Math.abs(a.atSec - c.start) < 1e-6)) {
      const wr = this.state.aligned[c.index]?.wordRange
      if (!wr || wr[1] <= wr[0]) return
      list.push({ atSec: c.start, startWord: wr[0], endWord: wr[1] })
    }

    const sorted = list.sort((a, b) => a.atSec - b.atSec)
    const pos = sorted.findIndex((a) => Math.abs(a.atSec - c.start) < 1e-6)
    const cur = sorted[pos]
    const prev = sorted[pos - 1]
    const next = sorted[pos + 1]
    let start = cur.startWord
    let end = cur.endWord
    if (edge === 'start') {
      start = Math.max(prev ? prev.endWord : 0, Math.min(start + delta, end - 1))
    } else {
      end = Math.min(next ? next.startWord : total, Math.max(end + delta, start + 1))
    }
    sorted[pos] = {
      atSec: cur.atSec,
      startWord: start,
      endWord: end,
      text: words.slice(start, end).join(' '),
    }
    this.anchors.set(fileName, sorted)
    this.persistCalibration()
    this.realign()
  }

  /** 去掉当前块的锚点（其余锚点不动） */
  clearAnchorHere() {
    const c = this.chunk()
    if (!c) return
    const fileName = this.state.fileName
    const list = this.anchors.get(fileName) ?? []
    const next = list.filter((a) => Math.abs(a.atSec - c.start) > 1e-6)
    if (next.length === list.length) return
    if (next.length > 0) this.anchors.set(fileName, next)
    else this.anchors.delete(fileName)
    this.persistCalibration()
    this.realign()
  }

  /** 清掉这一篇全部手动锚点，回到自动估计 */
  clearAnchors() {
    const fileName = this.state.fileName
    if (!this.anchors.has(fileName)) return
    this.anchors.delete(fileName)
    this.persistCalibration()
    this.realign()
  }

  /** 把这一篇当前的校准值写进持久化（没注入就只留在内存 Map 里） */
  private persistCalibration(fileName = this.state.fileName) {
    if (!fileName) return
    const anchors = this.anchors.get(fileName) ?? []
    const splits = this.splits.get(fileName) ?? []
    const merges = this.merges.get(fileName) ?? []
    this.deps.calibration?.set(fileName, {
      offsetWords: this.offsets.get(fileName) ?? 0,
      textStartChunk: this.starts.get(fileName) ?? 0,
      // 空的不写这个键，保持老记录的形状（也少占地方）
      ...(anchors.length > 0 ? { anchors } : {}),
      ...(splits.length > 0 ? { splits } : {}),
      ...(merges.length > 0 ? { merges } : {}),
    })
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

    const list = this.splits.get(fileName) ?? []
    if (list.some((s) => Math.abs(s - at) < 0.02)) return
    this.splits.set(fileName, [...list, at])

    // 这一刀正好落在此前的某次合并边界上：撕 = 抵消那次合并
    const merges = (this.merges.get(fileName) ?? []).filter((m) => Math.abs(m - at) > 0.02)
    if (merges.length > 0) this.merges.set(fileName, merges)
    else this.merges.delete(fileName)

    this.splitAnchorAt(c, at)
    this.persistCalibration()
    this.rederive()
  }

  /** 把当前块和下一块合并（等于删掉两条之间的边界）。可以拿来撤销一次撕开 */
  mergeCurrentWithNext() {
    const c = this.chunk()
    const next = this.state.chunks[this.state.current + 1]
    if (!c || !next) return
    const boundary = next.start
    const fileName = this.state.fileName

    const splits = this.splits.get(fileName) ?? []
    // 这条边界如果是「撕开」产生的，合并就是撤销那次撕开：
    // 把 split 删掉就够了，不该再记一条 merge（否则切分计数虚高，还可能误合）
    const wasSplit = splits.some((s) => Math.abs(s - boundary) < 0.02)
    const nextSplits = splits.filter((s) => Math.abs(s - boundary) > 0.02)
    if (nextSplits.length > 0) this.splits.set(fileName, nextSplits)
    else this.splits.delete(fileName)

    const merges = (this.merges.get(fileName) ?? []).filter((m) => Math.abs(m - boundary) > 0.02)
    if (!wasSplit) merges.push(boundary)
    if (merges.length > 0) this.merges.set(fileName, merges)
    else this.merges.delete(fileName)

    this.rejoinAnchorAcross(boundary)
    this.persistCalibration()
    this.rederive()
  }

  /** 清掉这一篇全部手动撕/合，回到纯 VAD 切块 */
  resetChunkEdits() {
    const fileName = this.state.fileName
    if (!this.splits.has(fileName) && !this.merges.has(fileName)) return
    this.splits.delete(fileName)
    this.merges.delete(fileName)
    this.persistCalibration()
    this.rederive()
  }

  /** 当前块起点上的锚点，按刀口比例拆成两个（两半的词都留着） */
  private splitAnchorAt(c: Chunk, at: number) {
    const fileName = this.state.fileName
    const list = this.anchors.get(fileName) ?? []
    const i = list.findIndex((a) => Math.abs(a.atSec - c.start) < 1e-6)
    if (i < 0) return
    const a = list[i]
    if (a.endWord - a.startWord < 2) return
    const words = this.wordList()
    const ratio = (at - c.start) / Math.max(1e-6, c.end - c.start)
    const mid = Math.min(a.endWord - 1, Math.max(a.startWord + 1, Math.round(a.startWord + (a.endWord - a.startWord) * ratio)))
    const first: ManualAnchor = {
      atSec: c.start,
      startWord: a.startWord,
      endWord: mid,
      text: words.slice(a.startWord, mid).join(' '),
    }
    const second: ManualAnchor = {
      atSec: at,
      startWord: mid,
      endWord: a.endWord,
      text: words.slice(mid, a.endWord).join(' '),
    }
    const next = [...list]
    next.splice(i, 1, first, second)
    this.anchors.set(fileName, next)
  }

  /** 合并边界时，把紧挨着边界前后的锚点重新并成一个 */
  private rejoinAnchorAcross(boundary: number) {
    const fileName = this.state.fileName
    const list = this.anchors.get(fileName) ?? []
    const atBoundary = list.find((a) => Math.abs(a.atSec - boundary) < 1e-6)
    if (!atBoundary) return
    const before = list
      .filter((a) => a.atSec < boundary - 1e-6)
      .sort((x, y) => y.atSec - x.atSec)[0]
    let next = list.filter((a) => a !== atBoundary)
    if (before) {
      const words = this.wordList()
      const end = Math.max(before.endWord, atBoundary.endWord)
      const merged: ManualAnchor = {
        ...before,
        endWord: end,
        text: words.slice(before.startWord, end).join(' '),
      }
      next = next.map((a) => (a === before ? merged : a))
    }
    if (next.length > 0) this.anchors.set(fileName, next)
    else this.anchors.delete(fileName)
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
  // 提前收尾：
  //   · 录音中按空格或 R = 我读完了，直接回放（不用等自动停）
  //   · 标准音/回放中按空格 = 中止这一轮；按 R 则中止并开始手动录音

  /**
   * 自动录音该录多久 —— 这只是**兜底上限**。
   * 正常情况下不用等满：说完停下几秒（默认 2.5 秒，可调）就自动结束进对比了。
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
  async runAutoCycle(): Promise<void> {    if (this.state.cycleStep === 'rec') {
      // 录音中按 = 我读完了，直接回放刚才那条
      await this.stopRecordingThenPlayback()
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
    const hangover = this.deps.voiceHangoverMs ?? this.state.hangoverMs
    this.recordTimer = setInterval(() => {
      const now = Date.now()
      const silentFor = now - this.lastVoiceAt
      const elapsed = now - this.recStartedAt
      if ((this.speechSeen && silentFor > hangover) || elapsed > ms) {
        this.clearRecordTimer()
        void this.stopRecordingThenPlayback()
      }
    }, 200)
  }

  /**
   * 停了录音、存下来，然后直接回放刚才那条（连续跟读的第 3 步）。
   * 只放「我的」，不再回头放标准音 —— 想对照标准音按 C 或再跑一轮。
   */
  private async stopRecordingThenPlayback(): Promise<void> {
    this.clearRecordTimer()
    const saved = await this.stopRecording()
    if (this.state.cycleStep !== 'rec') {
      this.set({ cycleStep: 'idle' })
      return
    }
    const gen = this.cycleGen
    this.set({ cycleStep: 'playback' })
    if (saved) await this.playTake(saved)
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
      this.noiseFloor = NOISE_FLOOR_INIT
      this.recPeak = 0
      this.set({ recording: true })
    } catch (e) {
      this.set({ error: e instanceof Error ? e.message : String(e) })
    }
  }

  /** 停止并保存；返回存下的那条（太短被丢掉时返回 null） */
  async stopRecording(): Promise<Take | null> {
    if (!this.state.recording) return null
    const c = this.chunk()
    this.clearRecordTimer()
    this.set({ recording: false, level: 0 })
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
      await this.stopRecordingThenPlayback()
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
