/**
 * 错因复习的**耐久状态**（schema v11 的 `writing_error_progress` 一行对应一张卡）。
 *
 * 为什么不再只靠 `answerEvents` 现算：
 * - 事件是审计日志，前端有 5000 条上限；旧的复习记录会被裁掉，卡片又变回“到期”。
 * - 暂停 / 已掌握 / 到期时间需要跨设备一致，必须有自己的状态行。
 * - 卡片内容也存一份，旧批改被归档后仍能复习。
 *
 * 状态机很小：active → paused / mastered，paused / mastered → active。
 * 纯函数；时间由调用方传入，方便测试。
 */
import type { AnswerEvent } from './answerEvents'
import type { WritingErrorCard } from './writingErrorReview'
import type { WritingRule } from './writingErrorRules'
import { isWritingRule } from './writingErrorRules'

export const WRITING_ERROR_PROGRESS_CAP = 2000
export const WRITING_ERROR_MASTER_STREAK = 6
export const WRITING_ERROR_INTERVALS_DAYS = [3, 7, 14, 30, 60] as const
/** 随机考默认最多抽这么多张，避免一次点开几百张。 */
export const WRITING_ERROR_RANDOM_LIMIT = 20

export type WritingErrorProgressStatus = 'active' | 'paused' | 'mastered'

export interface WritingErrorProgress {
  /** 与复习卡同一 id：`errfix:<rule>|<key>` */
  id: string
  rule: WritingRule
  key: string
  articleId: string
  sentenceId?: string
  examId?: string
  focus?: string
  original: string
  suggestion: string
  reason?: string
  status: WritingErrorProgressStatus
  streak: number
  reviews: number
  lastAt?: string
  lastCorrect?: boolean
  dueAt?: string
  createdAt: string
  updatedAt: string
}

function isObject(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v)
}

function text(v: unknown): string {
  return typeof v === 'string' ? v.trim() : ''
}

function num(v: unknown): number {
  const n = Number(v)
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 0
}

function isIso(v: string): boolean {
  return Number.isFinite(Date.parse(v))
}

function addDays(at: string, days: number): string {
  const t = Date.parse(at)
  return Number.isFinite(t) ? new Date(t + days * 24 * 60 * 60 * 1000).toISOString() : at
}

/** 外部输入（localStorage / SQLite / 备份）→ 进度行；坏行丢弃，不拖垮整份记录。 */
export function normalizeWritingErrorProgress(raw: unknown): WritingErrorProgress[] {
  if (!Array.isArray(raw)) return []
  const byId = new Map<string, WritingErrorProgress>()
  for (const item of raw) {
    if (!isObject(item)) continue
    const rule = text(item.rule) as WritingRule
    const key = text(item.key)
    const id = text(item.id) || `errfix:${rule}|${key}`
    if (!id.startsWith('errfix:') || !rule || !key) continue
    // rule 合法性 / id 一致性都过一遍；坏标签直接丢。
    if (!isWritingRule(rule)) continue
    if (id !== `errfix:${rule}|${key}`) continue
    const createdAt = text(item.createdAt)
    const updatedAt = text(item.updatedAt)
    const status: WritingErrorProgressStatus =
      item.status === 'paused' || item.status === 'mastered' ? item.status : 'active'
    const row: WritingErrorProgress = {
      id,
      rule,
      key,
      articleId: text(item.articleId),
      ...(text(item.sentenceId) ? { sentenceId: text(item.sentenceId) } : {}),
      ...(text(item.examId) ? { examId: text(item.examId) } : {}),
      ...(text(item.focus) ? { focus: text(item.focus) } : {}),
      original: text(item.original),
      suggestion: text(item.suggestion),
      ...(text(item.reason) ? { reason: text(item.reason) } : {}),
      status,
      streak: num(item.streak),
      reviews: num(item.reviews),
      ...(isIso(text(item.lastAt)) ? { lastAt: text(item.lastAt) } : {}),
      ...(typeof item.lastCorrect === 'boolean' ? { lastCorrect: item.lastCorrect } : {}),
      ...(isIso(text(item.dueAt)) ? { dueAt: text(item.dueAt) } : {}),
      createdAt: isIso(createdAt) ? createdAt : isIso(updatedAt) ? updatedAt : new Date().toISOString(),
      updatedAt: isIso(updatedAt) ? updatedAt : isIso(createdAt) ? createdAt : new Date().toISOString(),
    }
    if (row.status === 'mastered') row.streak = Math.max(row.streak, WRITING_ERROR_MASTER_STREAK)
    const old = byId.get(id)
    if (!old || row.updatedAt >= old.updatedAt) byId.set(id, row)
  }
  return [...byId.values()]
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, WRITING_ERROR_PROGRESS_CAP)
}

/** 从复习卡新建一行（还没复习，现在到期）。 */
export function writingErrorProgressFromCard(card: WritingErrorCard, nowIso: string): WritingErrorProgress {
  return {
    id: card.id,
    rule: card.rule,
    key: card.key,
    articleId: card.articleId,
    ...(card.sentenceId ? { sentenceId: card.sentenceId } : {}),
    ...(card.examId ? { examId: card.examId } : {}),
    ...(card.focus ? { focus: card.focus } : {}),
    original: card.original,
    suggestion: card.suggestion,
    ...(card.reason ? { reason: card.reason } : {}),
    status: 'active',
    streak: 0,
    reviews: 0,
    createdAt: nowIso,
    updatedAt: nowIso,
  }
}

function withCard(row: WritingErrorProgress, card: WritingErrorCard): WritingErrorProgress {
  return {
    ...row,
    articleId: card.articleId,
    ...(card.sentenceId ? { sentenceId: card.sentenceId } : { sentenceId: undefined }),
    ...(card.examId ? { examId: card.examId } : { examId: undefined }),
    ...(card.focus ? { focus: card.focus } : { focus: undefined }),
    original: card.original,
    suggestion: card.suggestion,
    ...(card.reason ? { reason: card.reason } : { reason: undefined }),
  }
}

/** 记录一次复习：答错 +1 天；连对按 3/7/14/30/60 天；连对 6 次 → mastered。 */
export function applyWritingErrorReview(
  progress: WritingErrorProgress | undefined,
  card: WritingErrorCard,
  correct: boolean,
  nowIso: string,
): WritingErrorProgress {
  const base = withCard(progress ?? writingErrorProgressFromCard(card, nowIso), card)
  const streak = correct ? base.streak + 1 : 0
  const mastered = streak >= WRITING_ERROR_MASTER_STREAK
  const interval = correct ? WRITING_ERROR_INTERVALS_DAYS[Math.min(streak - 1, WRITING_ERROR_INTERVALS_DAYS.length - 1)] : 1
  return {
    ...base,
    status: mastered ? 'mastered' : 'active',
    streak,
    reviews: base.reviews + 1,
    lastAt: nowIso,
    lastCorrect: correct,
    dueAt: mastered ? undefined : addDays(nowIso, interval),
    updatedAt: nowIso,
  }
}

/** 暂停 / 恢复：暂停不再进队列；恢复立即到期，重新从 0 连对开始。 */
export function setWritingErrorProgressStatus(
  progress: WritingErrorProgress | undefined,
  card: WritingErrorCard,
  status: 'active' | 'paused',
  nowIso: string,
): WritingErrorProgress {
  const base = withCard(progress ?? writingErrorProgressFromCard(card, nowIso), card)
  return {
    ...base,
    status,
    ...(status === 'active' ? { streak: 0, dueAt: nowIso } : {}),
    updatedAt: nowIso,
  }
}

/** 旧版只有 answerEvents：第一次拿到这张卡时把历史复习结果迁进来，不丢连续次数。 */
export function writingErrorProgressFromEvents(
  card: WritingErrorCard,
  events: readonly AnswerEvent[],
  nowIso: string,
): WritingErrorProgress {
  const relevant = events
    .filter((e) => e.questionId === card.id)
    .slice()
    .sort((a, b) => a.at.localeCompare(b.at))
  if (!relevant.length) return writingErrorProgressFromCard(card, nowIso)
  let row = writingErrorProgressFromCard(card, nowIso)
  row = { ...row, createdAt: relevant[0].at }
  for (const ev of relevant) {
    row = applyWritingErrorReview(row, card, ev.correct, ev.at)
  }
  // 历史事件的最后状态可能已 mastered；保留它，除非用户主动恢复。
  return { ...row, updatedAt: nowIso }
}

export function isWritingErrorProgressDue(row: WritingErrorProgress, now: Date = new Date()): boolean {
  if (row.status !== 'active') return false
  if (!row.dueAt) return true
  const t = Date.parse(row.dueAt)
  return Number.isFinite(t) && t <= now.getTime()
}

/** 这张卡是否真的练过（旧数据可能只有 lastAt，没有 reviews）。 */
export function isWritingErrorProgressPracticed(row: WritingErrorProgress | undefined): boolean {
  return !!row && (row.reviews > 0 || !!row.lastAt)
}

/** 「练过的不练」：从到期队列里滤掉已有复习记录的卡；没有进度行 = 没练过。 */
export function unpracticedWritingErrorCards(
  cards: readonly WritingErrorCard[],
  progress: readonly WritingErrorProgress[],
): WritingErrorCard[] {
  const byId = new Map(progress.map((p) => [p.id, p]))
  return cards.filter((card) => !isWritingErrorProgressPracticed(byId.get(card.id)))
}

/**
 * 主动复习（随机 / 全部）的池子：不受到期时间限制，但尊重「以后不再考」的暂停。
 * 已掌握的可以主动重练，所以不排除。
 */
export function reviewableWritingErrorCards(
  cards: readonly WritingErrorCard[],
  progress: readonly WritingErrorProgress[],
): WritingErrorCard[] {
  const byId = new Map(progress.map((p) => [p.id, p]))
  return cards.filter((card) => byId.get(card.id)?.status !== 'paused')
}

/** Fisher–Yates 洗牌；rng 可注入，测试用固定序列。 */
export function randomWritingErrorCards(
  cards: readonly WritingErrorCard[],
  limit = WRITING_ERROR_RANDOM_LIMIT,
  rng: () => number = Math.random,
): WritingErrorCard[] {
  const pool = [...cards]
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.min(i, Math.max(0, Math.floor(rng() * (i + 1))))
    const t = pool[i]
    pool[i] = pool[j]
    pool[j] = t
  }
  return pool.slice(0, Math.max(0, Math.floor(limit)))
}

/** 到期卡：没有进度行的卡按“现在到期”；paused / mastered 不出现。 */
export function dueCardsFromProgress(
  cards: readonly WritingErrorCard[],
  progress: readonly WritingErrorProgress[],
  now: Date = new Date(),
  limit = 30,
): WritingErrorCard[] {
  const byId = new Map(progress.map((p) => [p.id, p]))
  return cards
    .map((card) => ({ card, row: byId.get(card.id) }))
    .filter(({ row }) => !row || isWritingErrorProgressDue(row, now))
    .sort((a, b) => {
      const at = a.row?.dueAt ? Date.parse(a.row.dueAt) : 0
      const bt = b.row?.dueAt ? Date.parse(b.row.dueAt) : 0
      return at - bt || Date.parse(b.card.at) - Date.parse(a.card.at)
    })
    .slice(0, Math.max(0, limit))
    .map(({ card }) => card)
}

/** 合并导入：同 id 取 updatedAt 较新的；同时间取复习次数多的。 */
export function mergeWritingErrorProgress(
  current: readonly WritingErrorProgress[],
  incoming: readonly WritingErrorProgress[],
): WritingErrorProgress[] {
  const byId = new Map(current.map((p) => [p.id, p]))
  for (const row of incoming) {
    const old = byId.get(row.id)
    if (!old || row.updatedAt > old.updatedAt || (row.updatedAt === old.updatedAt && row.reviews > old.reviews)) {
      byId.set(row.id, row)
    }
  }
  return [...byId.values()]
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, WRITING_ERROR_PROGRESS_CAP)
}

/** 复习卡列表变化时补齐状态行（不覆盖已有复习进度）。 */
export function syncWritingErrorProgress(
  progress: readonly WritingErrorProgress[],
  cards: readonly WritingErrorCard[],
  nowIso: string,
  legacyEvents: readonly AnswerEvent[] = [],
): { next: WritingErrorProgress[]; added: number } {
  const byId = new Map(progress.map((p) => [p.id, p]))
  let added = 0
  for (const card of cards) {
    const old = byId.get(card.id)
    if (!old) {
      byId.set(
        card.id,
        legacyEvents.length
          ? writingErrorProgressFromEvents(card, legacyEvents, nowIso)
          : writingErrorProgressFromCard(card, nowIso),
      )
      added++
    } else {
      byId.set(card.id, { ...withCard(old, card), updatedAt: old.updatedAt })
    }
  }
  return {
    next: [...byId.values()]
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .slice(0, WRITING_ERROR_PROGRESS_CAP),
    added,
  }
}
