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
  chunkIndex: number
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
  release(): void
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
 * 手动对齐校准，按音频文件名记。
 * 数据很小（一篇两个整数），所以接口是同步的。
 */
export interface Calibration {
  /** 文本整体平移的词数 */
  offsetWords: number
  /** 正文从第几块开始 */
  textStartChunk: number
}

export interface CalibrationRepoPort {
  get(fileName: string): Calibration | undefined
  set(fileName: string, value: Calibration): void
}
