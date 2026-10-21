/**
 * 装饰鱼（`ui/FishLayer`）的尺寸与位置规则。
 *
 * 抽出来是因为这些是**纯算术 + 脏值兜底**：存在本机的数字可能是上次别的
 * 窗口尺寸下写的、也可能被人手改过，读回来一律先过这里，别让一条鱼飘到
 * 屏幕外面去。视图只负责把结果接到 style 上。
 */

/** 鱼的尺寸范围（px）。小于最小值拖不动，大于最大值会盖住正文 */
export const FISH_SIZE_MIN = 40
export const FISH_SIZE_MAX = 380
/**
 * 默认尺寸 = 最小档。
 *
 * 鱼只是装饰，第一次出现不该压住正文（以前默认 104px，页面一打开就有点抢眼）；
 * 想看大一点可以双击 / 滚轮 / 拖右下角手柄，存过的尺寸照旧以本机记录为准。
 */
export const FISH_SIZE_DEFAULT = FISH_SIZE_MIN
/** 双击循环的中间档：最大尺寸的 50% */
export const FISH_SIZE_HALF = Math.round(FISH_SIZE_MAX / 2)

/** 默认位置：右下角留一点边距 */
export const FISH_POS_DEFAULT = { right: 14, bottom: 12 }

export interface FishPos {
  right: number
  bottom: number
}

/** 把任意数值夹进尺寸范围；非数字回默认值 */
export function clampFishSize(w: number): number {
  if (!Number.isFinite(w)) return FISH_SIZE_DEFAULT
  return Math.round(Math.min(FISH_SIZE_MAX, Math.max(FISH_SIZE_MIN, w)))
}

/**
 * 双击切换尺寸：**最小 → 50% → 最大 → 最小**。
 *
 * 默认尺寸本身就是最小档，所以鱼刚出现时双击第一下就去 50%（否则第一下会
 * 「看起来没反应」）；滚轮 / 拖拽停在档与档之间的任意值时，第一下先回最小，
 * 再按三档循环。用当前尺寸推导，不另存状态，刷新 / 换页后行为一致。
 */
export function nextFishSize(current: number): number {
  const size = clampFishSize(current)
  if (Math.abs(size - FISH_SIZE_MIN) <= 1) return FISH_SIZE_HALF
  if (Math.abs(size - FISH_SIZE_HALF) <= 1) return FISH_SIZE_MAX
  return FISH_SIZE_MIN
}

/** 夹进可视区：右下角坐标不能为负，也不能把鱼推出左/上边 */
export function clampFishPos(right: number, bottom: number, size: number, viewport: { w: number; h: number }): FishPos {
  const maxRight = Math.max(0, viewport.w - size)
  const maxBottom = Math.max(0, viewport.h - size)
  return {
    right: Math.round(Math.min(Math.max(0, right), maxRight)),
    bottom: Math.round(Math.min(Math.max(0, bottom), maxBottom)),
  }
}

/** 读存下的尺寸字符串：空 / 脏 / 越界都回默认值 */
export function parseFishSize(raw: string | null): number {
  if (raw === null || raw.trim() === '') return FISH_SIZE_DEFAULT
  const n = Number(raw)
  if (!Number.isFinite(n) || n < FISH_SIZE_MIN || n > FISH_SIZE_MAX) return FISH_SIZE_DEFAULT
  return Math.round(n)
}

/** 读存下的位置 JSON：解析失败 / 缺字段 / 非数字都回默认位置 */
export function parseFishPos(raw: string | null): FishPos {
  if (!raw) return { ...FISH_POS_DEFAULT }
  try {
    const o = JSON.parse(raw) as { right?: unknown; bottom?: unknown } | null
    if (o && Number.isFinite(o.right) && Number.isFinite(o.bottom)) {
      return { right: Math.round(o.right as number), bottom: Math.round(o.bottom as number) }
    }
  } catch {
    // 脏数据回默认位置，不影响页面
  }
  return { ...FISH_POS_DEFAULT }
}
