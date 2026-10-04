/**
 * 练习记录：把每次「考试 / 听写 / 听力理解」的成绩记下来（持久化），供统计与回顾。
 *
 * 纯函数，方便单测；存储是一串记录，落 localStorage。
 */

export type PracticeKind = 'quiz' | 'dictation' | 'listening'

export const PRACTICE_LABEL: Record<PracticeKind, string> = {
  quiz: '考试',
  dictation: '听写',
  listening: '听力理解',
}

export interface PracticeRecord {
  /** ISO 时间 */
  at: string
  kind: PracticeKind
  /** 题数 / 段数 */
  total: number
  /** 答对数量 */
  correct: number
  /** 用时（秒），可选 */
  seconds?: number
}

/** 追加一条记录（保留最近 cap 条）。纯函数。 */
export function addPracticeRecord(list: PracticeRecord[], rec: PracticeRecord, cap = 500): PracticeRecord[] {
  return [...list, rec].slice(-Math.max(0, cap))
}

/** 正确率（0–1）；total<=0 时为 0。 */
export function accuracy(rec: PracticeRecord): number {
  return rec.total > 0 ? rec.correct / rec.total : 0
}

/** 最近 n 条（新的在前）。 */
export function recentPractice(list: PracticeRecord[], n = 10): PracticeRecord[] {
  return list.slice(-Math.max(0, n)).reverse()
}

export interface PracticeDayTotals {
  total: number
  correct: number
  count: number
}

/** 按天汇总（key = 本地 YYYY-MM-DD）。 */
export function practiceByDay(list: PracticeRecord[], dayKeyOf: (iso: string) => string): Map<string, PracticeDayTotals> {
  const map = new Map<string, PracticeDayTotals>()
  for (const r of list) {
    const k = dayKeyOf(r.at)
    const cur = map.get(k) ?? { total: 0, correct: 0, count: 0 }
    cur.total += r.total
    cur.correct += r.correct
    cur.count += 1
    map.set(k, cur)
  }
  return map
}
