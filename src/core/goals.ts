/**
 * 目标 / 备忘：把「今天读完了几篇文章」这类可量化的小目标记账。
 *
 * 「读完」的判定（见 ReaderApp 的接入）：
 *   1) 主判据：**速读把这篇过完**（一句句推到结尾）—— 自动、无需 AI；
 *   2) 兜底：在目标面板里**手动标记读完**（或撤销）；
 *   3) 同一天、同一篇只算一次（按 articleId 去重）。
 *
 * 纯函数，方便单测。
 */

export interface ReadDone {
  /** 本地日期键 YYYY-MM-DD */
  day: string
  /** 文章标识（articleIdentity） */
  articleId: string
  title: string
  /** ISO 时刻 */
  at: string
}

/** 记一次「读完」：同一天同一篇只留一条；按上限截断（留最近的）。 */
export function addReadDone(list: ReadDone[], entry: ReadDone, cap = 500): ReadDone[] {
  if (!entry.articleId) return list
  if (list.some((x) => x.day === entry.day && x.articleId === entry.articleId)) return list
  return [...list, entry].slice(-Math.max(0, cap))
}

/** 撤掉某天某篇的「读完」记录。 */
export function removeReadDone(list: ReadDone[], day: string, articleId: string): ReadDone[] {
  return list.filter((x) => !(x.day === day && x.articleId === articleId))
}

/** 某天读完的篇目（按时间）。 */
export function readDoneOn(list: ReadDone[], day: string): ReadDone[] {
  return list.filter((x) => x.day === day).sort((a, b) => a.at.localeCompare(b.at))
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
