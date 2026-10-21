import type { ReviewGrade } from './review'

/**
 * 背单词「加练 / 重练」的出场账本（纯函数）。
 *
 * 起因：忘记 / 模糊会把卡追加到队尾，收尾的「重练忘记的」又会重建队列。
 * 过去加练计数在 `retryForgot` 里被清零，于是「忘记 → 加练 → 重练 → 忘记」
 * 可以无限循环，一轮永远做不完。
 *
 * 规则只在这一次实现（hook 与视图只消费结果）：
 *   - 每张卡每轮最多出场 `MAX_CARD_APPEARANCES` 次（首见 1 + 加练 2），
 *     **跨「重练忘记的」保留**，只在开新一轮时重置；
 *   - 「模糊」本身最多触发 1 次加练（忘记可以触发到总上限）；
 *   - 已经过「选中文释义」门禁的卡，模糊 / 忘记只写 SRS，不再追加
 *     （那一关本身就是复习，再追加只会变成同一个卡反复考）；
 *   - 「重练忘记的」每轮只发起一次；已练满的卡不再进重练队列。
 *
 * 不替用户改评分：到上限只是「不再追加」，评分本身照原样写进 SRS。
 */

/** 每张卡每轮最多出场几次（首见 + 加练）。 */
export const MAX_CARD_APPEARANCES = 3

/** 「模糊」每张卡最多触发几次加练。 */
const HARD_EXTRA_LIMIT = 1

/** 一轮的出场账本。 */
export interface ExtraRound {
  /** 每张卡本轮已出场次数（首见算 1）。 */
  appearances: Readonly<Record<string, number>>
  /** 「模糊」已经触发过的加练次数。 */
  hardExtras: Readonly<Record<string, number>>
  /** 本轮是否已经点过「重练忘记的」。 */
  retried: boolean
}

/** 还没开始的空账本。 */
export function emptyExtraRound(): ExtraRound {
  return { appearances: {}, hardExtras: {}, retried: false }
}

/** 开新一轮：队列里每出现一次记 1 次出场。 */
export function beginExtraRound(ids: readonly string[]): ExtraRound {
  const appearances: Record<string, number> = {}
  for (const id of ids) appearances[id] = (appearances[id] ?? 0) + 1
  return { appearances, hardExtras: {}, retried: false }
}

/** 没有追加的原因：到本轮总上限 / 已过释义门禁。 */
export type ExtraBlock = 'cap' | 'gate'

export interface ExtraDecision {
  /** 记账后的状态（没有追加时原样返回）。 */
  round: ExtraRound
  /** 是否把这张卡追加到队尾。 */
  append: boolean
  /** 没追加时给界面一句话用的原因；不追加也不提示时为 null。 */
  blocked: ExtraBlock | null
}

/**
 * 评分后要不要把这张卡追加到队尾再加练一次。
 *
 * `gated` = 这张卡本次出场是过了「选中文释义」门禁的（由 `needsMeaningCheck`
 * 与 `canQuizMeaning` 判定，调用方只传结果）。
 */
export function planExtra(
  round: ExtraRound,
  id: string,
  grade: ReviewGrade,
  opts: { gated?: boolean } = {},
): ExtraDecision {
  if (grade !== 'again' && grade !== 'hard') return { round, append: false, blocked: null }
  const seen = round.appearances[id] ?? 0
  if (seen >= MAX_CARD_APPEARANCES) return { round, append: false, blocked: 'cap' }
  if (opts.gated) return { round, append: false, blocked: 'gate' }
  const hardUsed = round.hardExtras[id] ?? 0
  if (grade === 'hard' && hardUsed >= HARD_EXTRA_LIMIT) return { round, append: false, blocked: null }
  return {
    round: {
      ...round,
      appearances: { ...round.appearances, [id]: seen + 1 },
      hardExtras: grade === 'hard' ? { ...round.hardExtras, [id]: hardUsed + 1 } : round.hardExtras,
    },
    append: true,
    blocked: null,
  }
}

export interface RetryDecision {
  /** 记账后的状态（不管有没有真的进重练，`retried` 都会置位）。 */
  round: ExtraRound
  /** 真正进入重练的 id（已练满的已剔除，去重后保持传入顺序）。 */
  ids: string[]
  /** 因为本轮已练满而剔除的条数。 */
  capped: number
  /** 本轮已经重练过了，这次不发起。 */
  blocked: boolean
}

/**
 * 收尾「重练忘记的」：每轮只发起一次，且跳过已经练满上限的卡。
 * 进重练的卡也算一次出场（记进账本），所以重练里再评忘记时不会再无限追加。
 */
export function planRetryForgot(round: ExtraRound, ids: readonly string[]): RetryDecision {
  if (round.retried) return { round, ids: [], capped: 0, blocked: true }
  const appearances = { ...round.appearances }
  const kept: string[] = []
  let capped = 0
  for (const id of Array.from(new Set(ids))) {
    const seen = appearances[id] ?? 0
    if (seen >= MAX_CARD_APPEARANCES) {
      capped += 1
      continue
    }
    kept.push(id)
    appearances[id] = seen + 1
  }
  return {
    round: { appearances, hardExtras: round.hardExtras, retried: true },
    ids: kept,
    capped,
    blocked: false,
  }
}
