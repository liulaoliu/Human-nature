/** Model 层的边界。框架无关，测试时全部注入假实现。 */

import type { LearningData } from './learning'
import type { SavedArticle, VocabLibrary } from '../types/document'

export type { SavedArticle } from '../types/document'

export interface RecorderPort {
  start(): Promise<void>
  /**
   * 停录。实现方最好顺手标出「真正在说话的区间」——
   * 录音器手里才有解码能力，复读的 hook 没有 AudioContext。
   * 标不出来就省略这两个字段，回放退回整段。
   */
  stop(): Promise<{
    blob: Blob
    mimeType: string
    durationSec: number
    speechFrom?: number
    speechTo?: number
  }>
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

/** 一版词库快照的元信息（正文不在这里，取的时候再读） */
export interface VocabSnapshot {
  /** 落盘时刻（ISO），也当主键 */
  at: string
  /** 这一版有多少条 */
  count: number
}

/** 已保存文章仓储。实现可以是 IndexedDB、HTTP/SQLite，或测试里的内存假实现。 */
export interface ArticleRepoPort {
  list(): Promise<SavedArticle[]>
  get(id: string): Promise<SavedArticle | null>
  save(article: SavedArticle): Promise<void>
  remove(id: string): Promise<void>
  /** 启动时把本地兜底数据补进主存（读接口自身不做写入）。 */
  reconcile?(): Promise<void>
}

/**
 * 学习记录仓储（练习、错题、读完/精读、写作、复述、活动统计…）。
 *
 * 不是“偏好”：这些数据丢了，学习日志和统计就不可信，所以主存 SQLite；
 * localStorage 只作为同步缓存 / 无服务时的兜底。
 */
export interface LearningRepoPort {
  load(): Promise<LearningData | null>
  save(data: LearningData): Promise<void>
  /** 只提交变化的 section（按表删/插）；服务端不支持时也应实现成整份 save。 */
  savePartial(data: Partial<LearningData>): Promise<void>
  /** 首次迁移：只往空库写，避免两个标签页/两台机器互相覆盖。 */
  migrate(data: LearningData): Promise<{ migrated: boolean; value: LearningData } | null>
  /**
   * 用答题事件重建派生聚合（活动 / 题型统计），返回重建后的整份记录。
   * 服务端不支持时可以不实现（调用方按「做不到」处理，不报错）。
   */
  rebuildDerived?(): Promise<LearningData | null>
}

export interface VocabRepoPort {
  load(): Promise<VocabLibrary>
  save(library: VocabLibrary): Promise<void>
  clear(): Promise<void>
  /** 历史快照（新的在前）：每次覆盖都会留一份，误操作可回退多步 */
  listSnapshots?(): Promise<VocabSnapshot[]>
  /** 按时刻取回某一版快照 */
  loadSnapshot?(at: string): Promise<VocabLibrary | null>
  /**
   * 本机是否有**未同步到服务端**的改动。
   *
   * 不能拿「本机写入时间 > 服务端 updatedAt」代替：每次服务端保存成功也会写本机镜像，
   * 镜像时间经常比服务端晚几毫秒，结果把别处的新词库当成旧版。只有服务端写失败/离线
   * 落盘时才置脏，读的时候才允许本机优先。
   */
  markDirty?(): Promise<void>
  isDirty?(): Promise<boolean>
  clearDirty?(): Promise<void>
  /**
   * 取一条“这次加载需要让用户知道”的提示（取完即清，避免每次渲染重复弹）。
   * `needsSave` 表示合并结果需要回写一次服务端。
   */
  takeNotice?(): { message: string; needsSave?: boolean } | null
}
