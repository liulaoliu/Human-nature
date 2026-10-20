/**
 * 阅读页滚动进度：只认「比例」这一个口径（0 = 顶部，1 = 底部）。
 *
 * 为什么存比例不存像素：字号 / 加粗 / 衬线 / 译文显示都会改变正文高度，
 * 换设置后按像素恢复会错位（同一个 800px 在 4 倍字号下可能已经到底）。
 *
 * 纯逻辑，不碰 DOM：像素 ↔ 比例由调用方把可滚区间（scrollHeight - clientHeight）传进来。
 */
export const SCROLL_TOP = 0
export const SCROLL_BOTTOM = 1

/** 夹到 0–1；脏值（NaN / Infinity / 负数 / 字符串）回顶部。 */
export function clampScrollRatio(raw: unknown): number {
  const n = typeof raw === 'number' ? raw : Number.parseFloat(String(raw ?? ''))
  if (!Number.isFinite(n)) return SCROLL_TOP
  return Math.min(SCROLL_BOTTOM, Math.max(SCROLL_TOP, n))
}

/** 解析本机存下的进度（如 `"0.42"`）：没存过 / 脏值 → 顶部。 */
export function parseScrollRatio(raw: string | null): number {
  if (raw == null || raw.trim() === '') return SCROLL_TOP
  return clampScrollRatio(raw)
}

/** 当前位置 → 占比（没有可滚区间时算顶部，别算成 NaN）。 */
export function scrollRatioOf(top: number, scrollable: number): number {
  if (!Number.isFinite(top) || !(scrollable > 0)) return SCROLL_TOP
  return clampScrollRatio(top / scrollable)
}

/** 占比 → 该滚到的像素位置（比例 × 可滚区间）。 */
export function scrollTopOf(ratio: number, scrollable: number): number {
  if (!(scrollable > 0)) return 0
  return clampScrollRatio(ratio) * scrollable
}
