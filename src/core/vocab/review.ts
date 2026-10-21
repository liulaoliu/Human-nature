import type { ReviewState, VocabItem, VocabLibrary } from '../../types/document'
import { isPriority, sortItems } from './library'
import { displayMeaning } from './word'

/**
 * 复习排期（SM-2 变体）与背单词队列。
 *
 * 到期 / 间隔 / 优先重排的顺序全在这里算，视图只消费结果。
 */

export type ReviewGrade = 'again' | 'hard' | 'good' | 'easy'

/** 背单词的两种模式：新学习 / 复习。 */
export type StudyMode = 'learn' | 'review'

const QUALITY: Record<ReviewGrade, number> = { again: 1, hard: 3, good: 4, easy: 5 }

/** 重学阶段最多累计到几（只用于展示/审计，不影响队列上限）。 */
export const RELEARN_MAX = 3

function addDays(d: Date, days: number): Date {
  const r = new Date(d.getTime())
  r.setDate(r.getDate() + days)
  return r
}

/**
 * SM-2 变体的复习推进。纯函数，返回新的 ReviewState。
 *   - again（q=1）：重来，repetitions 归零，间隔 1 天，ease −0.2（下限 1.3），
 *     并进入 / 保持「重学」状态（`relearn + 1`，上限 3）。
 *   - 重学中的词答对：1 天 → 3 天，**连续第二次答对才退出重学**，之后回到正常间隔。
 *   - 正常词 hard/good/easy：repetitions +1，间隔 1 → 6 → round(interval × ease)
 *
 * 为什么重学要单独一档：以前 again 只把 repetitions 归零，词就掉回「新词」，
 * 复习队列只看 repetitions > 0，于是「记住过又忘」的词会在复习模式里消失。
 * 现在 `relearn` 是显式状态，队列据此把它排在复习最前，并按 1→3 天巩固。
 */
export function review(state: ReviewState, grade: ReviewGrade, now: Date = new Date()): ReviewState {
  const q = QUALITY[grade]
  let { ease, interval, repetitions } = state
  let lapses = state.lapses ?? 0
  let relearn = state.relearn ?? 0
  if (q < 3) {
    repetitions = 0
    interval = 1
    ease = Math.max(1.3, ease - 0.2)
    lapses += 1
    relearn = Math.min(RELEARN_MAX, relearn + 1)
  } else {
    repetitions += 1
    if (relearn > 0) {
      // 重学阶梯：先 1 天，再 3 天；第二次答对才退出重学状态
      if (repetitions === 1) interval = 1
      else if (repetitions === 2) {
        interval = 3
        relearn = 0
      } else interval = Math.min(6, Math.round(interval * ease))
    } else if (repetitions === 1) interval = 1
    else if (repetitions === 2) interval = 6
    else interval = Math.round(interval * ease)
    ease = Math.max(1.3, ease + (0.1 - (5 - q) * (0.08 + (5 - q) * 0.02)))
  }
  return {
    ease,
    interval,
    repetitions,
    due: addDays(now, interval).toISOString(),
    lapses,
    ...(relearn > 0 ? { relearn } : {}),
  }
}

/** 这个词是不是正在重学（拼错 / 记住过又忘记）。 */
export function isRelearning(item: VocabItem): boolean {
  return (item.reviewState.relearn ?? 0) > 0
}

/**
 * 从没被排期过的新词。
 *
 * 不能再用 `repetitions === 0` 判断：答错后 repetitions 也会归零，
 * 那样「学过但忘了」的词会被当成新词，既占每日新词配额、又挤不进复习队列。
 */
export function isFresh(item: VocabItem): boolean {
  const rs = item.reviewState
  return !isRelearning(item) && rs.repetitions === 0 && rs.interval === 0 && rs.due === null
}

/** 有过学习记录（排过期 / 答错过 / 正在重学）。 */
export function hasReviewHistory(item: VocabItem): boolean {
  const rs = item.reviewState
  return isRelearning(item) || rs.repetitions > 0 || rs.interval > 0 || rs.due !== null
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

/**
 * 这个词要不要在复习 / 加练时先做「选中文释义」。
 *
 * 起因：第一次学习就点「不认识」的词，第二次及以上如果仍然模糊或继续标不认识，
 * 只翻面看释义记不住。规则只在**已经标过不认识 / 正在重学**的词上生效：
 *   - 正在重学的词（拼错、记住过又忘）→ 每次出场都先选释义；
 *   - 记忆还没重新建立（repetitions = 0）→ 每次出场先选释义；
 *   - 本轮加练 / 收尾重练 → 即使刚评过模糊（repetitions 已 +1）也要先选。
 *
 * 不按 lapses 猜：lapses 只记「忘记」，普通第一次忘记不等于「不认识」。
 */
export function needsMeaningCheck(
  item: VocabItem,
  opts: { extra?: boolean; retrying?: boolean } = {},
): boolean {
  if (isRelearning(item)) return true
  if (!item.tags.includes('不认识')) return false
  return item.reviewState.repetitions === 0 || !!opts.extra || !!opts.retrying
}

/**
 * 释义关刚过（或锤炼里的选义题刚答对），却要点「忘记了」：先要一次确认。
 *
 * 这张卡刚刚证明「看到词能选出正确释义」，紧接着又判自己忘记，两个信号互相矛盾。
 * 这里**不替用户改分**（不偷偷降成 hard），只把自相矛盾的那一下拦成一次显式选择，
 * 避免迷迷糊糊把 repetitions 打回 0、整轮反复重学；确认后仍按原样写 again。
 */
export function needsForgotConfirm(opts: { grade: ReviewGrade; meaningProven: boolean }): boolean {
  return opts.grade === 'again' && opts.meaningProven
}

/**
 * 词库够不够出「正确释义 + 3 个干扰项」。
 * 与 `needsMeaningCheck` 分开：规则说该考，但词库太小出不了题时退回普通卡片。
 */
export function canQuizMeaning(item: VocabItem, items: VocabItem[]): boolean {
  const correct = displayMeaning(item)
  if (!correct) return false
  const others = new Set(items.filter((it) => it.id !== item.id).map((it) => displayMeaning(it)).filter(Boolean))
  others.delete(correct)
  return others.size >= 3
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
 * 到期组里：正在重学的排最前，其次「优先重排」（答错过的词），再按到期时间。
 */
export function buildStudyQueue(
  items: VocabItem[],
  now: Date = new Date(),
  opts: { newLimit?: number; newToday?: number } = {},
): VocabItem[] {
  const isDue = (it: VocabItem) => it.reviewState.due !== null && new Date(it.reviewState.due) <= now
  const rank = (it: VocabItem) => (isRelearning(it) ? 0 : isPriority(it, now) ? 1 : 2)
  const byDue = (a: VocabItem, b: VocabItem) =>
    rank(a) - rank(b) ||
    (a.reviewState.due ?? '').localeCompare(b.reviewState.due ?? '') ||
    a.createdAt.localeCompare(b.createdAt)
  const due = items.filter(isDue).sort(byDue)
  const freshAll = items.filter((it) => isFresh(it) && !isDue(it))
  const remaining =
    opts.newLimit && opts.newLimit > 0 ? Math.max(0, opts.newLimit - (opts.newToday ?? 0)) : Infinity
  const fresh = freshAll.slice(0, remaining)
  const rest = items.filter((it) => hasReviewHistory(it) && !isDue(it)).sort(byDue)
  return [...due, ...fresh, ...rest]
}

/**
 * 新学习队列：只取从来没排期过的新词，按加入时间。
 * 受每日新词配额限制（newLimit / newToday）。
 *
 * 重学中的词**不在这里**：它们有学习记录，走复习队列（见 `buildReviewQueue`），
 * 否则「以前认识、这次忘了」会被当成新词再学一遍、还占配额。
 */
export function buildLearnQueue(
  items: VocabItem[],
  _now: Date = new Date(),
  opts: { newLimit?: number; newToday?: number } = {},
): VocabItem[] {
  const fresh = items.filter(isFresh).sort((a, b) => a.createdAt.localeCompare(b.createdAt))
  const remaining =
    opts.newLimit && opts.newLimit > 0 ? Math.max(0, opts.newLimit - (opts.newToday ?? 0)) : Infinity
  return fresh.slice(0, remaining)
}

/**
 * 复习队列：所有「学过且到期」的，重学中的排最前，其次优先重排，再按到期时间升序。
 *
 * 判断用 `hasReviewHistory` 而不是 `repetitions > 0`：答错后 repetitions 会归零，
 * 但它仍然需要复习；把这类词排除掉，就等于把「记住过又忘」的词直接跳过了。
 */
export function buildReviewQueue(items: VocabItem[], now: Date = new Date()): VocabItem[] {
  return items
    .filter(
      (it) =>
        hasReviewHistory(it) &&
        it.reviewState.due !== null &&
        new Date(it.reviewState.due) <= now,
    )
    .sort(
      (a, b) =>
        (isRelearning(a) ? 0 : 1) - (isRelearning(b) ? 0 : 1) ||
        (isPriority(a, now) ? 0 : 1) - (isPriority(b, now) ? 0 : 1) ||
        (a.reviewState.due ?? '').localeCompare(b.reviewState.due ?? '') ||
        a.createdAt.localeCompare(b.createdAt),
    )
}
