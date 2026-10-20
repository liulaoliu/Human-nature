/**
 * 精读页顶栏「按钮区占几行」。
 *
 * 顶栏的控件本来就分四组（文章 / 视图与朗读 / 动作与入口 / 计时统计）。
 * 四行是默认排法；想把纵向空间还给正文时，可以把相邻的组并到一行：
 *
 *   4 行  [文章] [视图] [动作] [统计]        ← 默认，语义最清楚
 *   3 行  [文章] [视图] [动作 + 统计]
 *   2 行  [文章 + 视图] [动作 + 统计]
 *
 * 为什么从**尾部**开并：`统计` 只有一行文字加「显示 ⚙」，是四组里最矮的，
 * 跟 `动作` 并成一行最自然；`文章`（标题 + 选择器 + 保存/新建）和
 * `视图`（最多控件）各自放宽后仍然最长，把它们并起来最容易撑破一行。
 *
 * 并了之后一行会变宽：`auto` 宽度档是 `fit-content`，条子会跟着变宽；
 * 视窗不够宽时由行内 `flex-wrap` 兜底折行（设置项里已写「窄屏自动折」）。
 *
 * 「显示 ⚙」始终在 `统计` 组的最后一项、`统计` 又始终是最后一行，
 * 所以不管选几行，弹层都还在顶栏最右端往里开，不会溢出视窗。
 */

/** 顶栏里可以独立成行的四组控件。 */
export type ToolbarGroup = 'doc' | 'view' | 'action' | 'status'

/** 组在行内的先后顺序（合并时按这个顺序拼，不许乱序）。 */
export const TOOLBAR_GROUPS: readonly ToolbarGroup[] = ['doc', 'view', 'action', 'status']

/** 可选行数：4（默认）/ 3 / 2。 */
export const TOOLBAR_ROW_MODES = [4, 3, 2] as const
export type ToolbarRowMode = (typeof TOOLBAR_ROW_MODES)[number]

export const DEFAULT_TOOLBAR_ROWS: ToolbarRowMode = 4

export const TOOLBAR_ROWS_LABEL: Record<ToolbarRowMode, string> = {
  4: '4 行',
  3: '3 行',
  2: '2 行',
}

function isRowMode(n: number): n is ToolbarRowMode {
  return (TOOLBAR_ROW_MODES as readonly number[]).includes(n)
}

/** 本机存的脏值（旧版本、手改、空串、小数）一律回到默认的 4 行。 */
export function parseToolbarRows(raw: unknown): ToolbarRowMode {
  const n = typeof raw === 'number' ? raw : typeof raw === 'string' && raw.trim() !== '' ? Number(raw) : NaN
  return isRowMode(n) ? n : DEFAULT_TOOLBAR_ROWS
}

/**
 * 行数 → 每行放哪几组。
 *
 * 返回的二维数组拼起来必须刚好是 `TOOLBAR_GROUPS`（不丢、不重、不乱序）。
 */
export function planToolbarRows(mode: ToolbarRowMode): ToolbarGroup[][] {
  switch (mode) {
    case 2:
      return [['doc', 'view'], ['action', 'status']]
    case 3:
      return [['doc'], ['view'], ['action', 'status']]
    case 4:
    default:
      return [['doc'], ['view'], ['action'], ['status']]
  }
}

/** CSS 类名的行后缀：`tb-row-doc`、`tb-row-action-status`…（合并行按组名连字符拼）。 */
export function toolbarRowClass(groups: readonly ToolbarGroup[]): string {
  return groups.length > 0 ? 'tb-row tb-row-' + groups.join('-') : 'tb-row'
}
