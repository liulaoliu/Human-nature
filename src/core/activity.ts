/**
 * 学习统计：记录每天「听说读写词」各做了多少，并提供周/月汇总与热力图数据。
 *
 * 纯函数，方便单测。存储格式是一串按天的记录（`DayActivity`），落 localStorage。
 * 热力图布局借鉴 GitHub 贡献图：列 = 周、行 = 星期（周日起），未来留空。
 */

export type ActivityCat = 'read' | 'vocab' | 'listen' | 'write' | 'speak'

export const ACTIVITY_CATS: ActivityCat[] = ['read', 'vocab', 'listen', 'write', 'speak']

export const ACTIVITY_LABEL: Record<ActivityCat, string> = {
  read: '读',
  vocab: '词',
  listen: '听',
  write: '写',
  speak: '说',
}

export interface DayActivity {
  /** 本地日期 YYYY-MM-DD */
  day: string
  counts: Partial<Record<ActivityCat, number>>
}

/** 本地日期键 YYYY-MM-DD。 */
export function dayKeyLocal(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/** 把某天某类活动加 n（同一天合并；超过上限截断）。纯函数。 */
export function addActivity(
  list: DayActivity[],
  day: string,
  cat: ActivityCat,
  n = 1,
  cap = 400,
): DayActivity[] {
  if (!day || n <= 0) return list
  const i = list.findIndex((x) => x.day === day)
  let next: DayActivity[]
  if (i < 0) {
    next = [...list, { day, counts: { [cat]: n } }]
  } else {
    const cur = list[i]
    next = [...list]
    next[i] = { ...cur, counts: { ...cur.counts, [cat]: (cur.counts[cat] ?? 0) + n } }
  }
  next.sort((a, b) => a.day.localeCompare(b.day))
  return next.slice(-Math.max(0, cap))
}

/** 一天的总量。 */
export function dayTotal(a: DayActivity): number {
  let s = 0
  for (const c of ACTIVITY_CATS) s += a.counts[c] ?? 0
  return s
}

function emptyCats(): Record<ActivityCat, number> {
  return { read: 0, vocab: 0, listen: 0, write: 0, speak: 0 }
}

/** 统计 [from, to]（含）区间内各分类合计。from/to 为 YYYY-MM-DD。 */
export function sumCats(list: DayActivity[], from: string, to: string): Record<ActivityCat, number> {
  const out = emptyCats()
  for (const a of list) {
    if (a.day < from || a.day > to) continue
    for (const c of ACTIVITY_CATS) out[c] += a.counts[c] ?? 0
  }
  return out
}

/** 连续有活动的天数（从今天或昨天往前数）。 */
export function activityStreak(list: DayActivity[], today: Date = new Date()): number {
  const has = new Set(list.filter((a) => dayTotal(a) > 0).map((a) => a.day))
  const cursor = new Date(today.getFullYear(), today.getMonth(), today.getDate())
  if (!has.has(dayKeyLocal(cursor))) cursor.setDate(cursor.getDate() - 1)
  let streak = 0
  while (has.has(dayKeyLocal(cursor))) {
    streak += 1
    cursor.setDate(cursor.getDate() - 1)
  }
  return streak
}

/** 记录数 → 色阶（0 空，1–4 由浅到深）。与参考项目一致。 */
export function levelFor(count: number): number {
  if (count <= 0) return 0
  if (count <= 2) return 1
  if (count <= 5) return 2
  if (count <= 9) return 3
  return 4
}

export interface HeatCell {
  /** YYYY-MM-DD */
  key: string
  count: number
  level: number
  /** 未来日期（不画内容） */
  future: boolean
}

export interface Heatmap {
  columns: number
  /** cells[col][row]，row 0 = 周日 … 6 = 周六 */
  cells: HeatCell[][]
  monthLabels: { col: number; label: string }[]
  /** 最大值，用于图例说明 */
  max: number
}

/**
 * 构造固定 columns 周的热力图。起点为首周的周日，终点为今天；未来日期留空。
 * counts：日期键 → 当日总量。
 */
export function buildHeatmap(
  counts: Record<string, number>,
  columns = 13,
  today: Date = new Date(),
): Heatmap {
  const today0 = new Date(today.getFullYear(), today.getMonth(), today.getDate())
  const thisSunday = new Date(today0)
  thisSunday.setDate(today0.getDate() - today0.getDay()) // getDay(): 0=周日
  const start = new Date(thisSunday)
  start.setDate(thisSunday.getDate() - (columns - 1) * 7)

  const cells: HeatCell[][] = []
  const firstColOfMonth = new Map<number, number>()
  let max = 0
  for (let c = 0; c < columns; c++) {
    const col: HeatCell[] = []
    for (let r = 0; r < 7; r++) {
      const d = new Date(start)
      d.setDate(start.getDate() + c * 7 + r)
      const key = dayKeyLocal(d)
      const count = d > today0 ? 0 : counts[key] ?? 0
      const future = d > today0
      if (!future && !firstColOfMonth.has(d.getMonth())) firstColOfMonth.set(d.getMonth(), c)
      if (count > max) max = count
      col.push({ key, count, level: future ? 0 : levelFor(count), future })
    }
    cells.push(col)
  }

  const monthLabels = [...firstColOfMonth.entries()].map(([month, col]) => ({
    col,
    label: `${month + 1}`,
  }))
  return { columns, cells, monthLabels, max }
}
