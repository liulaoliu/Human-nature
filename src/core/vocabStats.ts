import type { VocabItem } from '../types/document'

/** 一次选词会话（与 reader 的 sessions 结构一致）。 */
export interface PickSession {
  at: string
  seconds: number
  picked: number
}

/** 背单词按天的累计（与 reader 的 studyDays 结构一致）。 */
export interface StudyDay {
  day: string
  seconds: number
  cards: number
}

/** 本机时区的日期键 YYYY-MM-DD。 */
function dayKey(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

/** 所有选词会话的累计（词数 / 秒数）。 */
export function sessionTotals(sessions: PickSession[]): { picked: number; seconds: number } {
  return sessions.reduce((a, s) => ({ seconds: a.seconds + s.seconds, picked: a.picked + s.picked }), {
    seconds: 0,
    picked: 0,
  })
}

/** 背单词时长合计：累计秒 / 累计评分次数 / 今日秒。 */
export function studyTotals(
  days: StudyDay[],
  todayKey = dayKey(new Date()),
): { totalSeconds: number; totalCards: number; todaySeconds: number } {
  let totalSeconds = 0
  let totalCards = 0
  let todaySeconds = 0
  for (const d of days) {
    totalSeconds += d.seconds
    totalCards += d.cards
    if (d.day === todayKey) todaySeconds = d.seconds
  }
  return { totalSeconds, totalCards, todaySeconds }
}

/** 今天选了多少词 + 连续打卡天数（今天没选则从昨天起算）。 */
export function pickDayStats(sessions: PickSession[], now = new Date()): { todayPicked: number; streak: number } {
  const byDay = new Map<string, number>()
  for (const s of sessions) {
    const k = dayKey(new Date(s.at))
    byDay.set(k, (byDay.get(k) ?? 0) + s.picked)
  }
  const todayKey = dayKey(now)
  const cursor = new Date(now)
  if (!byDay.has(todayKey)) cursor.setDate(cursor.getDate() - 1)
  let streak = 0
  while (byDay.has(dayKey(cursor))) {
    streak += 1
    cursor.setDate(cursor.getDate() - 1)
  }
  return { todayPicked: byDay.get(todayKey) ?? 0, streak }
}

/** 最近 7 天每天选了多少词。 */
export function last7Days(sessions: PickSession[], now = new Date()): { key: string; label: string; picked: number }[] {
  const byDay = new Map<string, number>()
  for (const s of sessions) {
    const k = dayKey(new Date(s.at))
    byDay.set(k, (byDay.get(k) ?? 0) + s.picked)
  }
  const out: { key: string; label: string; picked: number }[] = []
  for (let i = 6; i >= 0; i--) {
    const d = new Date(now)
    d.setDate(d.getDate() - i)
    const k = dayKey(d)
    out.push({ key: k, label: String(d.getDate()), picked: byDay.get(k) ?? 0 })
  }
  return out
}

/** 未来 N 天每天的到期词数。 */
export function dueForecast(
  items: VocabItem[],
  now = new Date(),
  days = 30,
): { key: string; label: string; count: number }[] {
  const byDay = new Map<string, number>()
  for (const it of items) {
    if (!it.reviewState.due) continue
    const k = dayKey(new Date(it.reviewState.due))
    byDay.set(k, (byDay.get(k) ?? 0) + 1)
  }
  const out: { key: string; label: string; count: number }[] = []
  for (let i = 0; i < days; i++) {
    const d = new Date(now)
    d.setDate(d.getDate() + i)
    const k = dayKey(d)
    out.push({ key: k, label: i === 0 ? '今天' : String(d.getDate()), count: byDay.get(k) ?? 0 })
  }
  return out
}

/** 按来源文章统计生词数（从多到少取前 N）。 */
export function wordsByArticle(items: VocabItem[], top = 10): [string, number][] {
  const m = new Map<string, number>()
  for (const it of items) {
    const k = it.source?.articleId || '未标来源'
    m.set(k, (m.get(k) ?? 0) + 1)
  }
  return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, top)
}
