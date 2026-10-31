/**
 * 错因复习卡：只从 **v2 批改记录** 里取 must-fix 错因，用 `questionId` 记到
 * `answerEvents`（不新增表、不新增同步段）。
 *
 * 间隔用 Leitner 的 1 / 3 / 7 / 14 / 30 / 60 天：
 * - 答错 → 1 天后再来；
 * - 连续答对 1–5 次 → 3 / 7 / 14 / 30 / 60 天；
 * - 连续答对 6 次 → 本轮掌握，不再进到期队列（错因仍在复盘里）。
 *
 * 为什么不用 SM-2：这里练的是「一条错因」，不是整句记忆；固定间隔更好解释，
 * 也方便以后换存储时对账。纯函数，时间由调用方传入。
 */
import type { AnswerEvent } from './answerEvents'
import type { WritingRecord } from './writing'
import type { GoldenExamItem } from '../types/document'
import {
  filterWritingErrorRecords,
  isValidWritingIssue,
  type WritingErrorQuery,
} from './writingErrors'
import {
  WRITING_RULE_LABEL,
  writingTypeOf,
  type WritingIssueType,
  type WritingRule,
} from './writingErrorRules'

export const ERROR_REVIEW_PREFIX = 'errfix:'

export interface WritingErrorCard {
  /** 复习卡 id（也写进 answerEvents.questionId） */
  id: string
  rule: WritingRule
  type: WritingIssueType
  key: string
  original: string
  suggestion: string
  reason?: string
  /** 学生原句，用来展示上下文 */
  text: string
  recordKey: string
  at: string
  articleId: string
  articleTitle?: string
  sentenceId?: string
  examId?: string
  focus?: string
}

export interface WritingErrorReviewState {
  id: string
  lastAt: string
  lastCorrect: boolean
  /** 连续答对次数；答错归零 */
  streak: number
  reviews: number
}

export interface WritingErrorReviewSchedule {
  /** null = 现在就可以练（从未复习） */
  dueAt: string | null
  mastered: boolean
}

const INTERVALS_DAYS = [3, 7, 14, 30, 60] as const

export function writingErrorCardId(rule: WritingRule, key: string): string {
  return `${ERROR_REVIEW_PREFIX}${rule}|${key}`
}

export function isWritingErrorCardId(value: string | undefined): value is string {
  return !!value && value.startsWith(ERROR_REVIEW_PREFIX)
}

/**
 * 把一张错因卡变成 AI 批改用的题面。
 *
 * 学生只写「改正后的片段」，但 AI 需要看到原句和错因，才能判断这个片段是否真的
 * 解决了问题；`model` 用改正后的完整句，批改反馈里能直接当参照。
 */
export function errorFixExamItem(card: WritingErrorCard): GoldenExamItem {
  const corrected =
    card.original && card.text.includes(card.original)
      ? card.text.replace(card.original, card.suggestion)
      : card.text
  return {
    id: card.id,
    sentenceId: card.sentenceId ?? card.examId ?? (card.recordKey || card.id),
    task: [
      `批改这条错因订正。原句：${card.text}`,
      `错因（${WRITING_RULE_LABEL[card.rule]}）：${card.original || '缺词'} → ${card.suggestion}。`,
      '学生只需写出改正后的片段，不要要求重写整句。',
    ].join(' '),
    model: corrected,
    structure: `错因类型：${WRITING_RULE_LABEL[card.rule]}`,
    mustUse: [],
    rubric: [
      {
        dimension: '错因修正',
        weight: 100,
        description: '只检查订正是否解决了这条错因，并指出仍然存在的写法问题。',
      },
    ],
    source: 'local',
    focus: `错因：${card.original || '缺词'} → ${card.suggestion}`,
  }
}

/** 从一批批改记录里取每张错因卡（同一 rule+key 只留最新一条）。 */
export function collectWritingErrorCards(
  records: readonly WritingRecord[],
  query: WritingErrorQuery,
): WritingErrorCard[] {
  const out: WritingErrorCard[] = []
  const seen = new Set<string>()
  for (const rec of filterWritingErrorRecords(records, query)) {
    if (!rec.feedback || rec.feedback.version !== 2) continue
    for (const issue of rec.feedback.issues ?? []) {
      if (!isValidWritingIssue(issue) || issue.severity !== 'must-fix') continue
      const id = writingErrorCardId(issue.rule, issue.key)
      if (seen.has(id)) continue
      seen.add(id)
      out.push({
        id,
        rule: issue.rule,
        type: writingTypeOf(issue.rule),
        key: issue.key,
        original: issue.original,
        suggestion: issue.suggestion,
        ...(issue.reason ? { reason: issue.reason } : {}),
        text: rec.text,
        recordKey: rec.recordKey ?? '',
        at: rec.at,
        articleId: rec.articleId,
        ...(rec.articleTitle ? { articleTitle: rec.articleTitle } : {}),
        ...(rec.sentenceId ? { sentenceId: rec.sentenceId } : {}),
        ...(rec.examId ? { examId: rec.examId } : {}),
        ...(rec.task?.focus ? { focus: rec.task.focus } : {}),
      })
    }
  }
  return out
}

/** 从 answerEvents 还原每张卡的复习状态（事件按时间正序归并）。 */
export function writingErrorReviewStates(
  events: readonly AnswerEvent[],
): Map<string, WritingErrorReviewState> {
  const out = new Map<string, WritingErrorReviewState>()
  const sorted = events
    .filter((e) => isWritingErrorCardId(e.questionId))
    .slice()
    .sort((a, b) => a.at.localeCompare(b.at))
  for (const ev of sorted) {
    const id = ev.questionId as string
    const old = out.get(id)
    out.set(id, {
      id,
      lastAt: ev.at,
      lastCorrect: ev.correct,
      streak: ev.correct ? (old?.streak ?? 0) + 1 : 0,
      reviews: (old?.reviews ?? 0) + 1,
    })
  }
  return out
}

function addDays(at: string, days: number): string {
  const t = Date.parse(at)
  return Number.isFinite(t) ? new Date(t + days * 24 * 60 * 60 * 1000).toISOString() : at
}

export function writingErrorReviewSchedule(
  state: WritingErrorReviewState | undefined,
): WritingErrorReviewSchedule {
  if (!state) return { dueAt: null, mastered: false }
  if (!state.lastCorrect) return { dueAt: addDays(state.lastAt, 1), mastered: false }
  if (state.streak >= INTERVALS_DAYS.length + 1) return { dueAt: null, mastered: true }
  const interval = INTERVALS_DAYS[Math.max(0, state.streak - 1)] ?? 60
  return { dueAt: addDays(state.lastAt, interval), mastered: false }
}

/** 到期队列：从未练的排最前，然后按到期时间；已掌握的不再出现。 */
export function dueWritingErrorCards(
  cards: readonly WritingErrorCard[],
  events: readonly AnswerEvent[],
  now: Date = new Date(),
  limit = 30,
): WritingErrorCard[] {
  const states = writingErrorReviewStates(events)
  const nowMs = now.getTime()
  return cards
    .map((card) => ({ card, schedule: writingErrorReviewSchedule(states.get(card.id)) }))
    .filter(({ schedule }) => {
      if (schedule.mastered) return false
      if (!schedule.dueAt) return true
      const t = Date.parse(schedule.dueAt)
      return Number.isFinite(t) && t <= nowMs
    })
    .sort((a, b) => {
      const at = a.schedule.dueAt ? Date.parse(a.schedule.dueAt) : 0
      const bt = b.schedule.dueAt ? Date.parse(b.schedule.dueAt) : 0
      return at - bt || Date.parse(b.card.at) - Date.parse(a.card.at)
    })
    .slice(0, Math.max(0, limit))
    .map(({ card }) => card)
}

function normalizeAnswer(text: string, caseSensitive: boolean): string {
  const s = text
    .replace(/[’‘]/g, "'")
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^[\s.,!?;:"“”]+|[\s.,!?;:"“”]+$/g, '')
  return caseSensitive ? s : s.toLowerCase()
}

/** 判断用户输入是否算对；大小写规则区分大小写，其余忽略大小写。 */
export function isWritingErrorAnswerCorrect(input: string, card: WritingErrorCard): boolean {
  const caseSensitive =
    card.rule === 'sentence-initial-capital' || card.rule === 'brand-name-capitalization'
  const a = normalizeAnswer(input, caseSensitive)
  const b = normalizeAnswer(card.suggestion, caseSensitive)
  return !!a && a === b
}
