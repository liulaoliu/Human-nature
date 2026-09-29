/** Model 层的边界。框架无关，测试时全部注入假实现。 */

export interface Chunk {
  index: number
  start: number // 秒
  end: number // 秒
}

export interface Take {
  id: string
  /**
   * 这条录音属于哪个音频文件（`fileName`）。
   * 必须记：录音原来只按「第几块」存，可不同文章的块号是从 0 开始的，
   * 练完 A 篇换到 B 篇，B 篇第 3 块就会显示 A 篇第 3 块的录音，
   * A/B 对比还会放出别人的声音。
   */
  fileName: string
  /**
   * 当时是第几块。**块号会变**（换切块档位、手动撕开都会重排），
   * 所以只作为老记录的兜底 —— 现在按 `startSec` 找块，见 `core/takeChunk.ts`。
   */
  chunkIndex: number
  /** 录这段时参考音的时间区间（秒）。有了它，撕开/换档位后录音不会串块 */
  startSec?: number
  endSec?: number
  blob: Blob
  mimeType: string
  durationSec: number
  createdAt: number
}

export type Granularity = 'short' | 'normal' | 'long'

export const GRANULARITY_MS: Record<Granularity, number> = {
  short: 150,
  normal: 400,
  long: 700,
}

export const GRANULARITY_LABEL: Record<Granularity, string> = {
  short: '短',
  normal: '中',
  long: '长',
}

/** 播放。playRange 在区间播完后 resolve —— A/B 编排靠这个串起来。 */
export interface AudioPlayerPort {
  load(blob: Blob): Promise<void>
  playRange(start: number, end: number, rate: number): Promise<void>
  playWhole(rate: number): Promise<void>
  /** 播放一条跟读录音（用独立元素，不动参考音频的位置） */
  playTake(take: Take, rate: number): Promise<void>
  /**
   * 可选：录音回放的额外放大倍数（1 = 不变，2 = 放大 100%）。
   * 加在「对齐标准音响度」之后，所以是相对标准音的额外增益。
   */
  setTakeBoost?(mult: number): void
  pause(): void
  /** 参考音当前播到哪儿（秒）。暂停/播完后停在最后的位置，用来做「接着播」 */
  readonly position: number
  readonly duration: number
  readonly sampleRate: number
  /** 解码后的单声道采样，给 VAD 用 */
  readonly samples: Float32Array
  release(): void
}

export interface RecorderPort {
  start(): Promise<void>
  stop(): Promise<{ blob: Blob; mimeType: string; durationSec: number }>
  /** 0..1，输入电平 */
  onLevel(cb: (v: number) => void): void
  /**
   * 采集参数：选哪个设备、要不要浏览器那套降噪。
   * 可选 —— 单测里的假录音器不实现也能跑，真实录音器在 start 前会读它。
   */
  configure?(opts: MicOptions): void
  release(): void
}

/** 麦克风采集参数 */
export interface MicOptions {
  /**
   * 原声优先：关掉浏览器的降噪 / 回声消除 / 自动增益。
   * Chrome 的降噪很激进，人声会被削得发闷（像隔着一层）；练发音听的就是音色，
   * 所以默认走原声。嘈杂环境可以退回降噪那一档。
   */
  raw?: boolean
  /** 选定的输入设备。不填用系统默认 */
  deviceId?: string
}

/** 录音持久化。切块结果不存，每次打开重跑 VAD 即可（100ms）。 */
export interface TakeRepoPort {
  save(take: Take): Promise<void>
  list(): Promise<Take[]>
  remove(id: string): Promise<void>
  clear(): Promise<void>
}

/**
 * 原文库查询结果。
 *
 * library=false 表示库**根本没取到**（没起 dev server、路径不对、离线），
 * 和「库取到了但没有这一篇」是两回事，必须分开报 ——
 * 不然在浏览器里出问题只看得出「没原文」，看不出是哪一步断的。
 */
export interface ScriptLookup {
  /** 找到了就是正文，没找到是 null */
  text: string | null
  /** 库到底取到了没有 */
  library: boolean
}

export interface ScriptRepoPort {
  find(fileName: string): Promise<ScriptLookup>
}

/**
 * 用户手动改过的正文（「改文本」那条路）。
 * 存在原文库之外：有它就用它，没有才回原文库 / 空白。
 * 数据可能几 KB～几十 KB，但一篇一份、改一次写一次，用 localStorage 够。
 */
export interface ScriptEditRepoPort {
  get(fileName: string): string | undefined
  set(fileName: string, text: string): void
  remove(fileName: string): void
}

/**
 * 鼠标选字的手动锚点：把「某一块的音频」绑到「原文里的一段词」。
 *
 * 记 atSec 而不是块号，是为了换切块粒度后还能找回是哪一块
 * （块号会变，音频时间不会）。
 */
export interface ManualAnchor {
  /** 锚定时那一块在音频里的起始秒 */
  atSec: number
  /** 这段词在原文里的起止词序号 [startWord, endWord) */
  startWord: number
  endWord: number
  /**
   * 锚定时选中的那段原文（词用空格连）。
   * 改文本后词序号会整体挪位，靠它在新的词表里重新定位，
   * 这样「改别处的错字」不会把已标好的进度打乱。
   */
  text?: string
}

/**
 * 手动对齐校准，按音频文件名记。
 * 数据很小（一篇几个数字 + 少量锚点），所以接口是同步的。
 */
export interface Calibration {
  /** 文本整体平移的词数 */
  offsetWords: number
  /** 正文从第几块开始 */
  textStartChunk: number
  /** 鼠标选字定下来的锚点。有锚点时上面两个自动估计值让位 */
  anchors?: ManualAnchor[]
  /**
   * 手动撕开的时间点（秒）。VAD 切出的大块在这里再切一刀。
   * 和锚点一样按音频时间记，换切块粒度后仍认。见 `core/chunkEdits.ts`。
   */
  splits?: number[]
  /** 手动合并：把「起点是这个时间」的那一块并进上一块（秒） */
  merges?: number[]
}

export interface CalibrationRepoPort {
  get(fileName: string): Calibration | undefined
  set(fileName: string, value: Calibration): void
}
