/**
 * 目标 / 备忘：把「今天读完了几篇文章」这类可量化的小目标记账。
 *
 * 「读完」的判定（见 ReaderApp 的接入）：
 *   1) 主判据：**速读把这篇过完**（一句句推到结尾）—— 自动、无需 AI；
 *   2) 兜底：在目标面板里**手动标记读完**（或撤销）；
 *   3) **同一篇只记第一次读完的那天**（按 articleId 全局去重）：换一天重读不再计入，
 *      第二天也不会又被列入。
 *
 * 纯函数，方便单测。
 */

export interface ReadDone {
  /** 本地日期键 YYYY-MM-DD（**第一次**读完的那天） */
  day: string
  /** 文章标识（articleIdentity） */
  articleId: string
  title: string
  /** ISO 时刻 */
  at: string
}

/**
 * 记一次「读完」：**同一篇只记第一次**（换一天重读不再计入，也就不会第二天又被列入）。
 * 按上限截断（留最近的）。
 */
export function addReadDone(list: ReadDone[], entry: ReadDone, cap = 500): ReadDone[] {
  if (!entry.articleId) return list
  if (list.some((x) => x.articleId === entry.articleId)) return list
  return [...list, entry].slice(-Math.max(0, cap))
}

/** 撤掉某篇的「读完」记录（不分哪天）。 */
export function removeReadDone(list: ReadDone[], articleId: string): ReadDone[] {
  return list.filter((x) => x.articleId !== articleId)
}

/** 某天读完的篇目（按时间）。 */
export function readDoneOn(list: ReadDone[], day: string): ReadDone[] {
  return list.filter((x) => x.day === day).sort((a, b) => a.at.localeCompare(b.at))
}

/** 这篇**第一次**读完是哪天（没读过返回 null）。 */
export function readDayOf(list: ReadDone[], articleId: string | null | undefined): string | null {
  if (!articleId) return null
  return list.find((x) => x.articleId === articleId)?.day ?? null
}

/** 历史：按天分组（新的在前）。 */
export function groupReadDone(list: ReadDone[]): { day: string; items: ReadDone[] }[] {
  const byDay = new Map<string, ReadDone[]>()
  for (const r of list) {
    const arr = byDay.get(r.day)
    if (arr) arr.push(r)
    else byDay.set(r.day, [r])
  }
  return [...byDay.entries()]
    .map(([day, items]) => ({ day, items: items.sort((a, b) => a.at.localeCompare(b.at)) }))
    .sort((a, b) => b.day.localeCompare(a.day))
}

/** 累计：读过的篇数 / 有记录的天数。 */
export function readDoneTotals(list: ReadDone[]): { articles: number; days: number } {
  return { articles: list.length, days: new Set(list.map((x) => x.day)).size }
}

/** 合并两份「读完」记录（按 articleId 去重，保留已有的）。 */
export function mergeReadDone(a: ReadDone[], b: ReadDone[]): ReadDone[] {
  const seen = new Set(a.map((x) => x.articleId))
  const add = b.filter((x) => x.articleId && !seen.has(x.articleId))
  return [...a, ...add]
}

/**
 * 目标热力图的色阶：一天读完几篇（0 空、1–3 逐级加深、≥4 满色）。
 * 篇数本来就个位数，用活动量那套阈值（1/2/3/6/10）会全是浅色。
 */
export function goalLevel(count: number): number {
  if (count <= 0) return 0
  return Math.min(4, count)
}

/** 目标进度百分比（0–100）。target<=0 表示不设目标：读过就算 100，否则 0。 */
export function goalPct(done: number, target: number): number {
  if (target <= 0) return done > 0 ? 100 : 0
  return Math.min(100, Math.round((done / target) * 100))
}

/** 是否达成目标（不设目标 = 不做判定）。 */
export function goalReached(done: number, target: number): boolean {
  return target > 0 && done >= target
}
