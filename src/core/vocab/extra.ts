import type { ReviewGrade } from './review'

/**
 * 背单词「加练 / 重练」的出场账本（纯函数）。
 *
 * 规则（2026-10-21 改版，用户明确要求）：
 *   - 评「忘记了」→ 本轮队尾再出现一次，**不设次数上限**，直到用户评「认识」或「模糊」；
 *   - 评「模糊」/「认识」→ 本轮不再追加（模糊就是收尾条件，不是再来一遍）；
 *   - 「重练忘记的」每轮只发起一次，全部忘记过的词都进队（不再按旧上限剔除）。
 *
 * 为什么不再封顶：3 次上限会让「一直记不住」的词在第 3 次之后被放过，等于替用户
 * 决定「可以了」。代价是用户一直点「忘记」时这一轮做不完——但停不停由用户决定
 * （评认识/模糊、切下一个、结束），程序不替他跳过。
 *
 * 复习侧仍有兜底：again 会写 `ReviewState.relearn`（+1），这个词下次进复习队列
 * 时排在「需要多复习」的最前，并从「看词 → 释义 → 锤炼」重新走一遍。
 */
export interface ExtraRound {
  /** 每张卡本轮已出场次数（首见算 1），只用于展示 / 审计。 */
  appearances: Readonly<Record<string, number>>
  /** 本轮是否已经点过「重练忘记的」。 */
  retried: boolean
}

/** 还没开始的空账本。 */
export function emptyExtraRound(): ExtraRound {
  return { appearances: {}, retried: false }
}

/** 开新一轮：队列里每出现一次记 1 次出场。 */
export function beginExtraRound(ids: readonly string[]): ExtraRound {
  const appearances: Record<string, number> = {}
  for (const id of ids) appearances[id] = (appearances[id] ?? 0) + 1
  return { appearances, retried: false }
}

export interface ExtraDecision {
  /** 记账后的状态（没有追加时原样返回）。 */
  round: ExtraRound
  /** 是否把这张卡追加到队尾。 */
  append: boolean
}

/**
 * 评分后要不要把这张卡追加到队尾再加练一次。
 *
 * 只有「忘记了」追加；「认识 / 模糊」都是本轮收尾，不再追加。
 * 不封顶：同一个词连续评忘记，就会一直回到队尾，直到评出认识或模糊。
 */
export function planExtra(round: ExtraRound, id: string, grade: ReviewGrade): ExtraDecision {
  if (grade !== 'again') return { round, append: false }
  const seen = round.appearances[id] ?? 0
  return {
    round: { ...round, appearances: { ...round.appearances, [id]: seen + 1 } },
    append: true,
  }
}

export interface RetryDecision {
  /** 记账后的状态（不管有没有真的进重练，`retried` 都会置位）。 */
  round: ExtraRound
  /** 真正进入重练的 id（去重后保持传入顺序）。 */
  ids: string[]
  /** 本轮已经重练过了，这次不发起。 */
  blocked: boolean
}

/**
 * 收尾「重练忘记的」：每轮只发起一次，忘记过的词全部进队。
 * 进重练的卡也算一次出场（记进账本）。
 */
export function planRetryForgot(round: ExtraRound, ids: readonly string[]): RetryDecision {
  if (round.retried) return { round, ids: [], blocked: true }
  const kept = Array.from(new Set(ids))
  const appearances = { ...round.appearances }
  for (const id of kept) appearances[id] = (appearances[id] ?? 0) + 1
  return { round: { appearances, retried: true }, ids: kept, blocked: false }
}
