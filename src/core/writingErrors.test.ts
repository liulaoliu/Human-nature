import { describe, it, expect } from 'vitest'
import { dayKeyLocal } from './activity'
import { writingTypeOf } from './writingErrorRules'
import { writingErrorHeadline, summarizeWritingErrors } from './writingErrors'
import type { WritingFeedback, WritingIssue, WritingRecommendation, WritingRecord } from './writing'

const now = new Date(2026, 9, 31, 12, 0, 0)

function issue(
  rule: WritingIssue['rule'],
  key: string,
  severity: WritingIssue['severity'] = 'must-fix',
  extra: Partial<WritingIssue> = {},
): WritingIssue {
  return {
    original: extra.original ?? 'x',
    suggestion: extra.suggestion ?? 'y',
    reason: extra.reason ?? 'r',
    type: extra.type ?? writingTypeOf(rule),
    rule,
    key,
    severity,
  }
}

function rec(opts: {
  at: string
  articleId?: string
  sentenceId?: string
  text?: string
  total?: number
  max?: number
  issues?: WritingIssue[]
  recommendations?: WritingRecommendation[]
  version?: number
}): WritingRecord {
  const feedback: WritingFeedback = {
    ...(opts.version === undefined || opts.version === 2 ? { version: 2 as const } : {}),
    scores: [],
    total: opts.total ?? 60,
    max: opts.max ?? 100,
    issues: opts.issues ?? [],
    recommendations: opts.recommendations ?? [],
  }
  return {
    at: opts.at,
    articleId: opts.articleId ?? 'a1',
    articleTitle: '文章一',
    model: 'm',
    text: opts.text ?? 'This is a test sentence.',
    feedback,
    ...(opts.sentenceId ? { sentenceId: opts.sentenceId } : {}),
  }
}

describe('summarizeWritingErrors：口径', () => {
  it('按篇 / 全库过滤；只分析 v2', () => {
    const records = [
      rec({ at: '2026-10-30T10:00:00.000Z', issues: [issue('tense-choice', 'tense-choice')] }),
      rec({ at: '2026-10-30T11:00:00.000Z', articleId: 'a2', issues: [] }),
      rec({
        at: '2026-10-30T12:00:00.000Z',
        issues: [issue('word-spelling', 'spelling-x')],
        version: 1,
      }),
    ]
    const article = summarizeWritingErrors(records, { scope: 'article', articleId: 'a1', now })
    expect(article.totalRecords).toBe(2)
    expect(article.analyzedRecords).toBe(1)
    expect(article.mustFix).toBe(1)
    const all = summarizeWritingErrors(records, { scope: 'all', now })
    expect(all.totalRecords).toBe(3)
    expect(all.analyzedRecords).toBe(2)
    expect(all.mustFix).toBe(1)
  })

  it('错因订正记录不反哺错因趋势（避免改错生新卡）', () => {
    const records = [
      rec({ at: '2026-10-30T10:00:00.000Z' }),
      {
        ...rec({ at: '2026-10-31T10:00:00.000Z', issues: [issue('word-spelling', 'spelling-x')] }),
        source: 'goldenError' as const,
      },
    ]
    const s = summarizeWritingErrors(records, { scope: 'all', now })
    expect(s.totalRecords).toBe(1)
    expect(s.analyzedRecords).toBe(1)
  })

  it('同一记录同一 key 只算一次，AI 拆两条不重复计数', () => {
    const records = [
      rec({
        at: '2026-10-30T10:00:00.000Z',
        issues: [
          issue('comma-followed-by-space', 'comma-followed-by-space'),
          issue('comma-followed-by-space', 'comma-followed-by-space'),
          issue('word-spelling', 'spelling-bureaucracy'),
        ],
      }),
    ]
    const s = summarizeWritingErrors(records, { scope: 'all', now })
    expect(s.totalIssues).toBe(2)
    expect(s.byRule.find((r) => r.rule === 'comma-followed-by-space')?.count).toBe(1)
  })

  it('规则汇总带 examples、records、articles，按 mustFix 排序', () => {
    const records = [
      rec({
        at: '2026-10-29T10:00:00.000Z',
        issues: [
          issue('word-spelling', 'spelling-a', 'must-fix', { original: 'bureacracy', suggestion: 'bureaucracy' }),
          issue('literal-translation', 'literal-my-personal-things', 'improvement', {
            original: 'personal things',
            suggestion: 'private matters',
          }),
        ],
      }),
      rec({
        at: '2026-10-30T10:00:00.000Z',
        articleId: 'a2',
        issues: [issue('word-spelling', 'spelling-a', 'must-fix', { original: 'bureacracy' })],
      }),
    ]
    const s = summarizeWritingErrors(records, { scope: 'all', now })
    expect(s.byRule[0].rule).toBe('word-spelling')
    expect(s.byRule[0]).toMatchObject({ count: 2, records: 2, articles: 2, mustFix: 2 })
    expect(s.byRule[0].examples).toHaveLength(1)
    expect(s.byType[0]).toMatchObject({ type: 'spelling', mustFix: 2 })
    expect(s.byArticle[0].articleId).toBe('a2')
  })

  it('分数换算百分制；平均 / 最高', () => {
    const records = [
      rec({ at: '2026-10-29T10:00:00.000Z', total: 30, max: 50 }),
      rec({ at: '2026-10-30T10:00:00.000Z', total: 80, max: 100 }),
    ]
    const s = summarizeWritingErrors(records, { scope: 'all', now })
    expect(s.averageScore).toBe(70)
    expect(s.bestScore).toBe(80)
  })

  it('日期过滤 + 趋势按逻辑日（4 点结算）', () => {
    const records = [
      rec({ at: new Date(2026, 9, 29, 12).toISOString(), issues: [issue('tense-choice', 'tense-choice')] }),
      rec({ at: new Date(2026, 9, 30, 2).toISOString(), issues: [issue('tense-choice', 'tense-choice')] }),
      rec({ at: new Date(2026, 9, 30, 12).toISOString(), issues: [issue('tense-choice', 'tense-choice')] }),
    ]
    const s = summarizeWritingErrors(records, { scope: 'all', now, sinceDays: 3, trendDays: 3 })
    // 10-30 02:00 属于 10-29 逻辑日；趋势看最近 3 天。
    expect(s.series.map((p) => p.day)).toEqual([
      dayKeyLocal(new Date(2026, 9, 29, 12)),
      dayKeyLocal(new Date(2026, 9, 30, 12)),
      dayKeyLocal(new Date(2026, 9, 31, 12)),
    ])
    expect(s.series.map((p) => p.count)).toEqual([2, 1, 0])
  })

  it('句子组按尝试次数排；记录最近 openRules 和最好分', () => {
    const records = [
      rec({
        at: '2026-10-28T10:00:00.000Z',
        sentenceId: 's1',
        total: 30,
        issues: [issue('incomplete-clause', 'incomplete-clause')],
      }),
      rec({
        at: '2026-10-29T10:00:00.000Z',
        sentenceId: 's1',
        total: 80,
        issues: [],
      }),
      rec({ at: '2026-10-30T10:00:00.000Z', sentenceId: 's2', total: 50, issues: [issue('tense-choice', 'tense-choice')] }),
    ]
    const s = summarizeWritingErrors(records, { scope: 'all', now })
    expect(s.sentences[0].sentenceId).toBe('s1')
    expect(s.sentences[0].attempts.map((a) => a.percent)).toEqual([30, 80])
    expect(s.sentences[0].bestPercent).toBe(80)
    expect(s.sentences[0].lastPercent).toBe(80)
    expect(s.sentences[0].openRules).toEqual([])
    expect(s.sentences[0].topRules).toContain('incomplete-clause')
  })

  it('推荐按 kind+point 去重，保留最小 priority / 最新 why', () => {
    const r1: WritingRecommendation = {
      kind: 'chunk',
      point: 'come to an end',
      why: '第一次',
      priority: 3,
      from: 'error',
      issueKey: 'chunk-come-to-an-end',
    }
    const r2: WritingRecommendation = { ...r1, why: '第二次', priority: 1, from: 'ai' }
    const records = [
      rec({ at: '2026-10-29T10:00:00.000Z', recommendations: [r1] }),
      rec({ at: '2026-10-30T10:00:00.000Z', recommendations: [r2] }),
    ]
    const s = summarizeWritingErrors(records, { scope: 'all', now })
    expect(s.recommendations).toHaveLength(1)
    expect(s.recommendations[0]).toMatchObject({ point: 'come to an end', count: 2, priority: 1, why: '第二次' })
  })

  it('推荐按文章/句子拆组，同名语言点不会把加入本课指到别的篇', () => {
    const make = (articleId: string, sentenceId: string) =>
      rec({
        at: '2026-10-30T10:00:00.000Z',
        articleId,
        sentenceId,
        recommendations: [
          {
            kind: 'chunk',
            point: 'come to an end',
            why: 'y',
            priority: 2,
            from: 'error',
            issueKey: 'chunk-come-to-an-end',
          },
        ],
      })
    const s = summarizeWritingErrors([make('a1', 's1'), make('a2', 's2')], { scope: 'all', now })
    expect(s.recommendations).toHaveLength(2)
    expect(s.recommendations.map((r) => r.articleId).sort()).toEqual(['a1', 'a2'])
  })

  it('空数据 / 缺 articleId 不抛错', () => {
    expect(summarizeWritingErrors([], { scope: 'all', now })).toMatchObject({ totalRecords: 0, analyzedRecords: 0 })
    expect(summarizeWritingErrors([], { scope: 'article', now }).scope).toBe('article')
    expect(writingErrorHeadline(summarizeWritingErrors([], { scope: 'all', now }))).toContain('还没有')
  })
})
