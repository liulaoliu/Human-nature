/**
 * 批改历史 → 错因复盘（纯函数）。
 *
 * 只吃 `version: 2` 的记录：旧记录已经由 `tools/backfill-writing-v2.mjs` 一次性回填，
 * 所以这里不写「旧格式兜底」的第二套分类逻辑。数据脏就跳过，不让一条坏记录带崩面板。
 *
 * 口径：
 * - `rule` 管趋势（跨句、跨篇）；`key` 管具体复习卡 / 去重。
 * - 同一记录里同一个 `key` 只算一次（AI 经常把一条错拆成两条）。
 * - 分数统一换算成百分制再平均，避免 40 分制 / 100 分制混在一起。
 */
import { dayKeyLocal } from './activity'
import {
  WRITING_RULE_LABEL,
  isWritingIssueKey,
  isWritingRule,
  writingKeySlug,
  writingTypeOf,
  type WritingIssueType,
  type WritingRule,
} from './writingErrorRules'
import {
  writingRecordKey,
  type WritingFeedback,
  type WritingIssue,
  type WritingRecommendation,
  type WritingRecord,
  type WritingSeverity,
} from './writing'

export type WritingErrorScope = 'article' | 'all'

export interface WritingErrorQuery {
  scope: WritingErrorScope
  /** scope=article 时必填 */
  articleId?: string
  /** 最近 N 天；不传 = 全部 */
  sinceDays?: number
  now?: Date
  /** 趋势图显示多少天（默认 14，最多 60） */
  trendDays?: number
}

export interface WritingErrorExample {
  recordKey: string
  at: string
  articleId: string
  articleTitle?: string
  sentenceId?: string
  examId?: string
  focus?: string
  /** 学生原句，复习卡用来挖空 */
  text: string
  original: string
  suggestion: string
  reason?: string
  severity: WritingSeverity
}

export interface WritingRuleSummary {
  rule: WritingRule
  type: WritingIssueType
  label: string
  /** 出现次数（同一记录同一 key 去重后） */
  count: number
  mustFix: number
  improvement: number
  /** 涉及多少条记录 / 多少篇文章 */
  records: number
  articles: number
  firstAt: string
  lastAt: string
  examples: WritingErrorExample[]
}

export interface WritingTypeSummary {
  type: WritingIssueType
  count: number
  mustFix: number
  improvement: number
}

export interface WritingArticleSummary {
  articleId: string
  articleTitle?: string
  records: number
  issues: number
  mustFix: number
  averageScore: number | null
  lastAt: string
}

export interface WritingTrendPoint {
  day: string
  count: number
  mustFix: number
}

export interface WritingAttemptPoint {
  at: string
  recordKey: string
  score: number
  max: number
  percent: number | null
  issues: number
  mustFix: number
  rules: WritingRule[]
}

export interface WritingSentenceSummary {
  articleId: string
  articleTitle?: string
  sentenceId?: string
  examId?: string
  focus?: string
  attempts: WritingAttemptPoint[]
  lastAt: string
  lastPercent: number | null
  bestPercent: number | null
  /** 所有尝试里出现过的 must-fix 规则，按次数降序 */
  topRules: WritingRule[]
  /** 最近一稿仍存在的 must-fix 规则 */
  openRules: WritingRule[]
}

export interface WritingRecommendationGroup {
  kind: WritingRecommendation['kind']
  point: string
  pointKey: string
  zh?: string
  why: string
  example?: string
  priority: 1 | 2 | 3
  from: WritingRecommendation['from']
  issueKey?: string
  pointId?: string
  articleId: string
  articleTitle?: string
  sentenceId?: string
  examId?: string
  count: number
  lastAt: string
}

export interface WritingErrorSummary {
  scope: WritingErrorScope
  sinceDays?: number
  trendDays: number
  totalRecords: number
  /** 真正参与统计的 v2 记录 */
  analyzedRecords: number
  averageScore: number | null
  bestScore: number | null
  totalIssues: number
  mustFix: number
  improvement: number
  lastAt: string
  byRule: WritingRuleSummary[]
  byType: WritingTypeSummary[]
  byArticle: WritingArticleSummary[]
  series: WritingTrendPoint[]
  sentences: WritingSentenceSummary[]
  recommendations: WritingRecommendationGroup[]
}

const EMPTY_SUMMARY: WritingErrorSummary = {
  scope: 'all',
  trendDays: 14,
  totalRecords: 0,
  analyzedRecords: 0,
  averageScore: null,
  bestScore: null,
  totalIssues: 0,
  mustFix: 0,
  improvement: 0,
  lastAt: '',
  byRule: [],
  byType: [],
  byArticle: [],
  series: [],
  sentences: [],
  recommendations: [],
}

export function isValidWritingIssue(issue: WritingIssue): boolean {
  return (
    !!issue &&
    isWritingRule(issue.rule) &&
    isWritingIssueKey(issue.key) &&
    (issue.severity === 'must-fix' || issue.severity === 'improvement') &&
    typeof issue.suggestion === 'string' &&
    issue.suggestion.trim().length > 0
  )
}

function validIssues(feedback: WritingFeedback | null | undefined): WritingIssue[] {
  if (!feedback || feedback.version !== 2 || !Array.isArray(feedback.issues)) return []
  return feedback.issues.filter(isValidWritingIssue)
}

function percentOf(total: number, max: number): number | null {
  if (!Number.isFinite(total) || !Number.isFinite(max) || max <= 0) return null
  return Math.round((total / max) * 100)
}

function timestamp(at: string): number {
  const t = Date.parse(at)
  return Number.isFinite(t) ? t : 0
}

function inScope(rec: WritingRecord, query: WritingErrorQuery, cutoff: number): boolean {
  if (query.scope === 'article' && rec.articleId !== query.articleId) return false
  if (!cutoff) return true
  const t = timestamp(rec.at)
  return t > 0 && t >= cutoff
}

/** 复盘 / 复习卡共用的筛选口径：scope + 最近 N 天。 */
export function filterWritingErrorRecords(
  records: readonly WritingRecord[],
  query: WritingErrorQuery,
): WritingRecord[] {
  const now = query.now ?? new Date()
  const sinceDays = query.sinceDays && query.sinceDays > 0 ? Math.floor(query.sinceDays) : undefined
  const cutoff = sinceDays ? now.getTime() - sinceDays * 24 * 60 * 60 * 1000 : 0
  return records.filter((r) => inScope(r, query, cutoff)).slice().sort((a, b) => timestamp(b.at) - timestamp(a.at))
}

function localDayKeys(now: Date, days: number): string[] {
  const out: string[] = []
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(now)
    d.setHours(12, 0, 0, 0)
    d.setDate(d.getDate() - i)
    out.push(dayKeyLocal(d))
  }
  return out
}

function exampleFrom(rec: WritingRecord, issue: WritingIssue): WritingErrorExample {
  return {
    recordKey: rec.recordKey || writingRecordKey(rec),
    at: rec.at,
    articleId: rec.articleId,
    ...(rec.articleTitle ? { articleTitle: rec.articleTitle } : {}),
    ...(rec.sentenceId ? { sentenceId: rec.sentenceId } : {}),
    ...(rec.examId ? { examId: rec.examId } : {}),
    ...(rec.task?.focus ? { focus: rec.task.focus } : {}),
    text: rec.text,
    original: issue.original,
    suggestion: issue.suggestion,
    ...(issue.reason ? { reason: issue.reason } : {}),
    severity: issue.severity,
  }
}

/** 一条错因的跨记录身份；和复习卡的 questionId 共用。 */
export function writingErrorSignature(issue: Pick<WritingIssue, 'rule' | 'key'>): string {
  return `${issue.rule}|${issue.key}`
}

/**
 * 汇总一批批改记录。
 *
 * - 记录按 `at` 新→旧排；同一记录同一 key 只算一次；
 * - 分数百分制；没有 max 的记录不参与平均；
 * - 推荐按 kind + point 去重，保留最新 why / 最小 priority。
 */
export function summarizeWritingErrors(
  records: readonly WritingRecord[],
  query: WritingErrorQuery,
): WritingErrorSummary {
  if (query.scope === 'article' && !query.articleId) return { ...EMPTY_SUMMARY, scope: 'article' }
  const now = query.now ?? new Date()
  const sinceDays = query.sinceDays && query.sinceDays > 0 ? Math.floor(query.sinceDays) : undefined
  const selected = filterWritingErrorRecords(records, query)

  const ruleMap = new Map<
    WritingRule,
    {
      count: number
      mustFix: number
      improvement: number
      records: Set<string>
      articles: Set<string>
      firstAt: string
      lastAt: string
      examples: WritingErrorExample[]
      exampleKeys: Set<string>
    }
  >()
  const typeMap = new Map<WritingIssueType, { count: number; mustFix: number; improvement: number }>()
  const articleMap = new Map<
    string,
    {
      articleTitle?: string
      records: number
      issues: number
      mustFix: number
      percents: number[]
      lastAt: string
    }
  >()
  const sentenceMap = new Map<
    string,
    {
      articleId: string
      articleTitle?: string
      sentenceId?: string
      examId?: string
      focus?: string
      attempts: WritingAttemptPoint[]
      ruleCounts: Map<WritingRule, number>
    }
  >()
  const recommendationMap = new Map<
    string,
    WritingRecommendationGroup & { _priority: number }
  >()
  const trendKeys = localDayKeys(now, Math.min(Math.max(query.trendDays ?? 14, 1), 60))
  const trendMap = new Map<string, { count: number; mustFix: number }>(
    trendKeys.map((day) => [day, { count: 0, mustFix: 0 }]),
  )

  let analyzedRecords = 0
  let totalIssues = 0
  let mustFix = 0
  let improvement = 0
  let scoreSum = 0
  let scoreCount = 0
  let bestScore: number | null = null
  let lastAt = ''

  for (const rec of selected) {
    const feedback = rec.feedback
    if (!feedback || feedback.version !== 2) continue
    const issues = validIssues(feedback)
    analyzedRecords++
    if (rec.at > lastAt) lastAt = rec.at
    const percent = percentOf(feedback.total, feedback.max)
    if (percent !== null) {
      scoreSum += percent
      scoreCount++
      if (bestScore === null || percent > bestScore) bestScore = percent
    }

    const recordKey = rec.recordKey || writingRecordKey(rec)
    const article = articleMap.get(rec.articleId) ?? {
      articleTitle: rec.articleTitle,
      records: 0,
      issues: 0,
      mustFix: 0,
      percents: [],
      lastAt: '',
    }
    article.records++
    if (rec.at > article.lastAt) article.lastAt = rec.at
    if (percent !== null) article.percents.push(percent)

    const sentenceKey = [rec.articleId, rec.sentenceId ?? rec.examId ?? '', rec.task?.focus ?? ''].join(
      '\u0000',
    )
    const sentence = sentenceMap.get(sentenceKey) ?? {
      articleId: rec.articleId,
      articleTitle: rec.articleTitle,
      ...(rec.sentenceId ? { sentenceId: rec.sentenceId } : {}),
      ...(rec.examId ? { examId: rec.examId } : {}),
      ...(rec.task?.focus ? { focus: rec.task.focus } : {}),
      attempts: [],
      ruleCounts: new Map<WritingRule, number>(),
    }

    const seen = new Set<string>()
    const attemptRules: WritingRule[] = []
    let attemptMustFix = 0
    for (const issue of issues) {
      if (seen.has(issue.key)) continue
      seen.add(issue.key)
      attemptRules.push(issue.rule)
      if (issue.severity === 'must-fix') attemptMustFix++
      totalIssues++
      if (issue.severity === 'must-fix') mustFix++
      else improvement++
      article.issues++
      if (issue.severity === 'must-fix') article.mustFix++

      const row = ruleMap.get(issue.rule) ?? {
        count: 0,
        mustFix: 0,
        improvement: 0,
        records: new Set<string>(),
        articles: new Set<string>(),
        firstAt: rec.at,
        lastAt: rec.at,
        examples: [],
        exampleKeys: new Set<string>(),
      }
      row.count++
      if (issue.severity === 'must-fix') row.mustFix++
      else row.improvement++
      row.records.add(recordKey)
      row.articles.add(rec.articleId)
      if (rec.at < row.firstAt) row.firstAt = rec.at
      if (rec.at > row.lastAt) row.lastAt = rec.at
      if (row.examples.length < 2 && !row.exampleKeys.has(issue.key)) {
        row.exampleKeys.add(issue.key)
        row.examples.push(exampleFrom(rec, issue))
      }
      ruleMap.set(issue.rule, row)

      const type = typeMap.get(issue.type) ?? { count: 0, mustFix: 0, improvement: 0 }
      type.count++
      if (issue.severity === 'must-fix') type.mustFix++
      else type.improvement++
      typeMap.set(issue.type, type)

      sentence.ruleCounts.set(issue.rule, (sentence.ruleCounts.get(issue.rule) ?? 0) + 1)

      const day = dayKeyLocal(new Date(rec.at))
      const trend = trendMap.get(day)
      if (trend) {
        trend.count++
        if (issue.severity === 'must-fix') trend.mustFix++
      }
    }
    articleMap.set(rec.articleId, article)

    sentence.attempts.push({
      at: rec.at,
      recordKey,
      score: feedback.total,
      max: feedback.max,
      percent,
      issues: issues.length,
      mustFix: attemptMustFix,
      rules: attemptRules,
    })
    sentenceMap.set(sentenceKey, sentence)

    for (const recItem of feedback.recommendations ?? []) {
      const point = recItem.point?.trim()
      if (!point) continue
      const key = `${recItem.kind}|${point.toLowerCase()}`
      const old = recommendationMap.get(key)
      const newer = !old || timestamp(rec.at) >= timestamp(old.lastAt)
      const priority = Math.min(old?._priority ?? 3, recItem.priority)
      recommendationMap.set(key, {
        kind: recItem.kind,
        point,
        pointKey: `${recItem.kind}-${writingKeySlug(point)}`,
        ...(newer && recItem.zh ? { zh: recItem.zh } : old?.zh ? { zh: old.zh } : {}),
        why: newer ? recItem.why : (old?.why ?? recItem.why),
        ...(newer
          ? recItem.example
            ? { example: recItem.example }
            : old?.example
              ? { example: old.example }
              : {}
          : old?.example
            ? { example: old.example }
            : {}),
        priority: priority as 1 | 2 | 3,
        from: newer ? recItem.from : (old?.from ?? recItem.from),
        ...(newer
          ? recItem.issueKey
            ? { issueKey: recItem.issueKey }
            : old?.issueKey
              ? { issueKey: old.issueKey }
              : {}
          : old?.issueKey
            ? { issueKey: old.issueKey }
            : {}),
        ...(newer
          ? recItem.pointId
            ? { pointId: recItem.pointId }
            : old?.pointId
              ? { pointId: old.pointId }
              : {}
          : old?.pointId
            ? { pointId: old.pointId }
            : {}),
        articleId: newer ? rec.articleId : (old?.articleId ?? rec.articleId),
        ...(newer
          ? rec.articleTitle
            ? { articleTitle: rec.articleTitle }
            : old?.articleTitle
              ? { articleTitle: old.articleTitle }
              : {}
          : old?.articleTitle
            ? { articleTitle: old.articleTitle }
            : {}),
        ...(newer
          ? rec.sentenceId
            ? { sentenceId: rec.sentenceId }
            : old?.sentenceId
              ? { sentenceId: old.sentenceId }
              : {}
          : old?.sentenceId
            ? { sentenceId: old.sentenceId }
            : {}),
        ...(newer
          ? rec.examId
            ? { examId: rec.examId }
            : old?.examId
              ? { examId: old.examId }
              : {}
          : old?.examId
            ? { examId: old.examId }
            : {}),
        count: (old?.count ?? 0) + 1,
        lastAt: newer ? rec.at : (old?.lastAt ?? rec.at),
        _priority: priority,
      })
    }
  }

  const byRule: WritingRuleSummary[] = [...ruleMap.entries()]
    .map(([rule, row]) => ({
      rule,
      type: writingTypeOf(rule),
      label: WRITING_RULE_LABEL[rule],
      count: row.count,
      mustFix: row.mustFix,
      improvement: row.improvement,
      records: row.records.size,
      articles: row.articles.size,
      firstAt: row.firstAt,
      lastAt: row.lastAt,
      examples: row.examples,
    }))
    .sort((a, b) => b.mustFix - a.mustFix || b.count - a.count || a.rule.localeCompare(b.rule))

  const byType: WritingTypeSummary[] = [...typeMap.entries()]
    .map(([type, row]) => ({ type, ...row }))
    .sort((a, b) => b.mustFix - a.mustFix || b.count - a.count)

  const byArticle: WritingArticleSummary[] = [...articleMap.entries()]
    .map(([articleId, row]) => ({
      articleId,
      ...(row.articleTitle ? { articleTitle: row.articleTitle } : {}),
      records: row.records,
      issues: row.issues,
      mustFix: row.mustFix,
      averageScore: row.percents.length
        ? Math.round(row.percents.reduce((a, b) => a + b, 0) / row.percents.length)
        : null,
      lastAt: row.lastAt,
    }))
    .sort((a, b) => b.mustFix - a.mustFix || b.records - a.records)

  const sentences: WritingSentenceSummary[] = [...sentenceMap.values()]
    .map((row) => {
      const attempts = row.attempts.sort((a, b) => timestamp(a.at) - timestamp(b.at))
      const percents = attempts.map((a) => a.percent).filter((p): p is number => p !== null)
      const lastAttempt = attempts[attempts.length - 1]
      const latestRules = lastAttempt?.rules ?? []
      const topRules = [...row.ruleCounts.entries()]
        .sort((a, b) => b[1] - a[1])
        .map(([rule]) => rule)
        .slice(0, 4)
      return {
        articleId: row.articleId,
        ...(row.articleTitle ? { articleTitle: row.articleTitle } : {}),
        ...(row.sentenceId ? { sentenceId: row.sentenceId } : {}),
        ...(row.examId ? { examId: row.examId } : {}),
        ...(row.focus ? { focus: row.focus } : {}),
        attempts,
        lastAt: attempts[attempts.length - 1]?.at ?? '',
        lastPercent: percents[percents.length - 1] ?? null,
        bestPercent: percents.length ? Math.max(...percents) : null,
        topRules,
        openRules: [...new Set(latestRules)],
      }
    })
    .sort((a, b) => b.attempts.length - a.attempts.length || timestamp(b.lastAt) - timestamp(a.lastAt))

  const recommendations: WritingRecommendationGroup[] = [...recommendationMap.values()]
    .map(({ _priority, ...row }) => ({ ...row, priority: _priority as 1 | 2 | 3 }))
    .sort((a, b) => a.priority - b.priority || b.count - a.count || timestamp(b.lastAt) - timestamp(a.lastAt))

  return {
    scope: query.scope,
    ...(sinceDays ? { sinceDays } : {}),
    trendDays: trendKeys.length,
    totalRecords: selected.length,
    analyzedRecords,
    averageScore: scoreCount ? Math.round(scoreSum / scoreCount) : null,
    bestScore,
    totalIssues,
    mustFix,
    improvement,
    lastAt,
    byRule,
    byType,
    byArticle,
    series: trendKeys.map((day) => ({ day, ...(trendMap.get(day) ?? { count: 0, mustFix: 0 }) })),
    sentences,
    recommendations,
  }
}

/** 面板顶部的一句话：只汇总，不重复算规则。 */
export function writingErrorHeadline(summary: WritingErrorSummary): string {
  if (!summary.analyzedRecords) return '还没有可复盘的批改记录'
  const top = summary.byRule.find((r) => r.mustFix > 0)
  const score = summary.averageScore !== null ? `平均 ${summary.averageScore}/100` : '还没有分数'
  return top
    ? `${score}；最常错：${top.label}（${top.mustFix} 次）`
    : `${score}；没有硬错，继续保持`
}
