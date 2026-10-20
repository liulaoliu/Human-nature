import type { Calibration, CalibrationRepoPort, ManualAnchor } from '../core/ports'

/**
 * 每篇音频的「手动校准」账本：文字平移量 / 正文起点 / 选字锚点 / 手动撕合。
 *
 * 从 `SessionStore` 里抽出来的原因：
 * - 这一坨 Map 的读写和持久化规则（空的不写、按文件名分篇、撤销撕开不该记 merge）
 *   跟播放/录音没关系，混在千行的 store 里既难读也难测；
 * - 规则本身有坑（`persist` 里空的键不写、空的数组等于删除），单独放一处才好写测试。
 *
 * 所有键都是**音频文件名**：换走再换回来还在（刷新页面也从 `CalibrationRepoPort` 读回来）。
 */
export class CalibrationLedger {
  private offsets = new Map<string, number>()
  private starts = new Map<string, number>()
  private anchors = new Map<string, ManualAnchor[]>()
  private splits = new Map<string, number[]>()
  private merges = new Map<string, number[]>()

  constructor(private repo?: CalibrationRepoPort) {}

  /** 读回上次存的（刷新页面不丢）。没有记录就什么都不做 */
  hydrate(fileName: string): void {
    const saved = this.repo?.get(fileName)
    if (!saved) return
    this.offsets.set(fileName, saved.offsetWords)
    this.starts.set(fileName, saved.textStartChunk)
    if (saved.anchors) this.anchors.set(fileName, saved.anchors)
    if (saved.splits?.length) this.splits.set(fileName, saved.splits)
    if (saved.merges?.length) this.merges.set(fileName, saved.merges)
  }

  offsetOf(fileName: string): number {
    return this.offsets.get(fileName) ?? 0
  }

  startOf(fileName: string): number {
    return this.starts.get(fileName) ?? 0
  }

  anchorsOf(fileName: string): ManualAnchor[] {
    return this.anchors.get(fileName) ?? []
  }

  splitsOf(fileName: string): number[] {
    return this.splits.get(fileName) ?? []
  }

  mergesOf(fileName: string): number[] {
    return this.merges.get(fileName) ?? []
  }

  setOffset(fileName: string, words: number): void {
    this.offsets.set(fileName, words)
  }

  setStart(fileName: string, chunk: number): void {
    this.starts.set(fileName, chunk)
  }

  /** 传空数组 = 这一篇没有锚点了（删键，不留空数组，`persist` 才判断得干净） */
  setAnchors(fileName: string, list: ManualAnchor[]): void {
    setOrDelete(this.anchors, fileName, list)
  }

  clearAnchors(fileName: string): void {
    this.anchors.delete(fileName)
  }

  setSplits(fileName: string, list: number[]): void {
    setOrDelete(this.splits, fileName, list)
  }

  setMerges(fileName: string, list: number[]): void {
    setOrDelete(this.merges, fileName, list)
  }

  /** 清掉这一篇全部手动撕/合（回到纯 VAD 切块） */
  clearEdits(fileName: string): void {
    this.splits.delete(fileName)
    this.merges.delete(fileName)
  }

  /** 这一篇手动撕/合了几处（界面上「已手动切 N 处」） */
  editCountOf(fileName: string): number {
    return this.splitsOf(fileName).length + this.mergesOf(fileName).length
  }

  /** 把这一篇当前的校准值写进持久化（没注入仓储就只留在内存里） */
  persist(fileName: string): void {
    if (!fileName) return
    const anchors = this.anchorsOf(fileName)
    const splits = this.splitsOf(fileName)
    const merges = this.mergesOf(fileName)
    const value: Calibration = {
      offsetWords: this.offsetOf(fileName),
      textStartChunk: this.startOf(fileName),
      // 空的不写这个键，保持老记录的形状（也少占地方）
      ...(anchors.length > 0 ? { anchors } : {}),
      ...(splits.length > 0 ? { splits } : {}),
      ...(merges.length > 0 ? { merges } : {}),
    }
    this.repo?.set(fileName, value)
  }
}

/** 空数组等于「删掉这一篇的这项」，别在 Map 里留 `[]`（`persist` 判断会变复杂） */
function setOrDelete<T>(map: Map<string, T[]>, key: string, list: T[]): void {
  if (list.length > 0) map.set(key, list)
  else map.delete(key)
}
