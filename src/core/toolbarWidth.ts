/**
 * 精读页顶栏「按钮区」的宽度。
 *
 * 为什么要定宽：顶栏有四行按钮，铺满整个视窗时，按钮会随窗口宽度一起被拉开／挤紧，
 * 窗口一大就「飘」得很散。给一个有上下限的宽度、居中排，按钮位置就稳定了。
 *
 * 默认档 `auto` 只跟视窗有关：约 72%，夹在 800–1800 之间——
 * 1080 视窗 → 800，1366 → 984，1920 → 1382，2560 → 封顶 1800（更宽的屏不再继续拉）。
 * 用户可以在「显示 ⚙」里改成固定档位，选择存在本机（见 `hooks/useReaderPrefs`）。
 */

export type ToolbarWidth = 'auto' | 'narrow' | 'wide' | 'full'

export const TOOLBAR_WIDTHS: readonly ToolbarWidth[] = ['auto', 'narrow', 'wide', 'full']

/** 自适应档的比例与上下限。改这里，`toolbarWidthCss` 与文档一起变。 */
export const TOOLBAR_RATIO = 0.72
export const TOOLBAR_MIN = 800
export const TOOLBAR_MAX = 1800
/**
 * 窄屏兜底的留白（px）。
 * 顶栏自己有 34px 的左右内边距，这里只补一点，避免按钮紧贴视窗边缘。
 */
export const TOOLBAR_GUTTER = 0

/** 固定档的宽度（px）。 */
export const TOOLBAR_FIXED: Record<'narrow' | 'wide', number> = { narrow: 1000, wide: 1400 }

export const TOOLBAR_WIDTH_LABEL: Record<ToolbarWidth, string> = {
  auto: '自适应',
  narrow: '窄',
  wide: '宽',
  full: '铺满',
}

export function isToolbarWidth(v: unknown): v is ToolbarWidth {
  return typeof v === 'string' && (TOOLBAR_WIDTHS as readonly string[]).includes(v)
}

/** 本机存的脏值（旧版、手改、空串）一律回到默认的自适应档。 */
export function parseToolbarWidth(raw: unknown): ToolbarWidth {
  return isToolbarWidth(raw) ? raw : 'auto'
}

export interface ToolbarWidthStyle {
  width: string
  minWidth?: string
  maxWidth: string
}

/**
 * 档位 → CSS 宽度（三个属性一起给，调用方直接铺到 `style` 上）。
 *
 * `auto` 用 `fit-content`：**按钮多宽，条就多宽**，再给 800 的下限——
 * 窗口从 1080 拉到 2560，这条始终是同一块、同一个位置（居中），
 * 不会像固定 1800 那样「容器很宽、按钮全挤在左边」。
 * 只有窄屏（< 848）才会被 `max-width` 压住，此时行内换行兜底。
 */
export function toolbarWidthStyle(mode: ToolbarWidth): ToolbarWidthStyle {
  /* 100% = 顶栏内容区（已扣掉它自己的左右内边距） */
  const cap = TOOLBAR_GUTTER > 0 ? `calc(100% - ${TOOLBAR_GUTTER}px)` : '100%'
  if (mode === 'full') return { width: '100%', maxWidth: '100%' }
  if (mode === 'narrow' || mode === 'wide') {
    return { width: `min(${TOOLBAR_FIXED[mode]}px, ${cap})`, maxWidth: cap }
  }
  return { width: 'fit-content', minWidth: `min(${TOOLBAR_MIN}px, ${cap})`, maxWidth: cap }
}
