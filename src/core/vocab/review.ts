import type { ReviewState, VocabItem, VocabLibrary } from '../../types/document'
import { isPriority, sortItems } from './library'

/**
 * 复习排期（SM-2 变体）与背单词队列。
 *
 * 到期 / 间隔 / 优先重排的顺序全在这里算，视图只消费结果。
 */

export type ReviewGrade = 'again' | 'hard' | 'good' | 'easy'

/** 背单词的两种模式：新学习 / 复习。 */
export type StudyMode = 'learn' | 'review'

const QUALITY: Record<ReviewGrade, number> = { again: 1, hard: 3, good: 4, easy: 5 }

function addDays(d: Date, days: number): Date {
  const r = new Date(d.getTime())
  r.setDate(r.getDate() + days)
  return r
}

/**
 * SM-2 变体的复习推进。纯函数，返回新的 ReviewState。
 *   - again（q=1）：重来，repetitions 归零，间隔 1 天，ease −0.2（下限 1.3）
 *   - hard/good/easy：repetitions +1，间隔 1 → 6 → round(interval × ease)
 */
export function review(state: ReviewState, grade: ReviewGrade, now: Date = new Date()): ReviewState {
  const q = QUALITY[grade]
  let { ease, interval, repetitions } = state
  let lapses = state.lapses ?? 0
  if (q < 3) {
    repetitions = 0
    interval = 1
    ease = Math.max(1.3, ease - 0.2)
    lapses += 1
  } else {
    repetitions += 1
    if (repetitions === 1) interval = 1
    else if (repetitions === 2) interval = 6
    else interval = Math.round(interval * ease)
    ease = Math.max(1.3, ease + (0.1 - (5 - q) * (0.08 + (5 - q) * 0.02)))
  }
  return { ease, interval, repetitions, due: addDays(now, interval).toISOString(), lapses }
}

/** 推进某个词条的复习状态。 */
export function reviewItem(
  library: VocabLibrary,
  id: string,
  grade: ReviewGrade,
  now: Date = new Date(),
): VocabLibrary {
  return {
    ...library,
    items: library.items.map((it) =>
      it.id === id ? { ...it, reviewState: review(it.reviewState, grade, now), updatedAt: now.toISOString() } : it,
    ),
  }
}

export function isDue(item: VocabItem, now: Date = new Date()): boolean {
  return item.reviewState.due !== null && new Date(item.reviewState.due) <= now
}

/** 到期（含逾期）的词条，按到期时间升序。 */
export function dueItems(items: VocabItem[], now: Date = new Date()): VocabItem[] {
  return sortItems(items.filter((it) => isDue(it, now)), 'due')
}

/** 次日 ISO（优先重排用）。 */
export function nextDayIso(now: Date = new Date()): string {
  return addDays(now, 1).toISOString()
}

/**
 * 背单词的出场顺序：先到期的，再没学过的，最后其它。
 * opts.newLimit / newToday 用来限制「每天新词量」。
 * 「优先重排」（答错过的词，priorityUntil 未过期）排在到期组最前。
 */
export function buildStudyQueue(
  items: VocabItem[],
  now: Date = new Date(),
  opts: { newLimit?: number; newToday?: number } = {},
): VocabItem[] {
  const isDue = (it: VocabItem) => it.reviewState.due !== null && new Date(it.reviewState.due) <= now
  const prio = (it: VocabItem) => (isPriority(it, now) ? 0 : 1)
  const byDue = (a: VocabItem, b: VocabItem) =>
    prio(a) - prio(b) ||
    (a.reviewState.due ?? '').localeCompare(b.reviewState.due ?? '') ||
    a.createdAt.localeCompare(b.createdAt)
  const due = items.filter(isDue).sort(byDue)
  const freshAll = items.filter((it) => it.reviewState.repetitions === 0 && !isDue(it))
  const remaining =
    opts.newLimit && opts.newLimit > 0 ? Math.max(0, opts.newLimit - (opts.newToday ?? 0)) : Infinity
  const fresh = freshAll.slice(0, remaining)
  const rest = items.filter((it) => it.reviewState.repetitions > 0 && !isDue(it)).sort(byDue)
  return [...due, ...fresh, ...rest]
}

/**
 * 新学习队列：只取「没学过」（repetitions=0）的，按加入时间。
 * 受每日新词配额限制（newLimit / newToday）。
 */
export function buildLearnQueue(
  items: VocabItem[],
  _now: Date = new Date(),
  opts: { newLimit?: number; newToday?: number } = {},
): VocabItem[] {
  const fresh = items
    .filter((it) => it.reviewState.repetitions === 0)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
  const remaining =
    opts.newLimit && opts.newLimit > 0 ? Math.max(0, opts.newLimit - (opts.newToday ?? 0)) : Infinity
  return fresh.slice(0, remaining)
}

/** 复习队列：只取「已学过且到期」的，优先重排的最前，其次按到期时间升序（逾期最久在前）。 */
export function buildReviewQueue(items: VocabItem[], now: Date = new Date()): VocabItem[] {
  return items
    .filter(
      (it) =>
        it.reviewState.repetitions > 0 &&
        it.reviewState.due !== null &&
        new Date(it.reviewState.due) <= now,
    )
    .sort(
      (a, b) =>
        (isPriority(a, now) ? 0 : 1) - (isPriority(b, now) ? 0 : 1) ||
        (a.reviewState.due ?? '').localeCompare(b.reviewState.due ?? '') ||
        a.createdAt.localeCompare(b.createdAt),
    )
}
