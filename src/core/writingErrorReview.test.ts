import { describe, expect, it } from 'vitest'
import type { AnswerEvent } from './answerEvents'
import type { WritingIssue, WritingRecord } from './writing'
import {
  collectWritingErrorCards,
  dueWritingErrorCards,
  errorFixExamItem,
  isWritingErrorAnswerCorrect,
  writingErrorCardId,
  writingErrorReviewSchedule,
  writingErrorReviewStates,
} from './writingErrorReview'

const now = new Date('2026-10-31T12:00:00.000Z')

function issue(
  rule: WritingIssue['rule'],
  key: string,
  severity: WritingIssue['severity'] = 'must-fix',
  over: Partial<WritingIssue> = {},
): WritingIssue {
  return {
    original: over.original ?? 'x',
    suggestion: over.suggestion ?? 'y',
    reason: over.reason ?? 'r',
    type: over.type ?? 'spelling',
    rule,
    key,
    severity,
  }
}

function rec(at: string, issues: WritingIssue[], over: Partial<WritingRecord> = {}): WritingRecord {
  return {
    at,
    articleId: 'a1',
    articleTitle: 'A',
    model: 'm',
    text: 'I learn bureacracy.',
    feedback: { version: 2, scores: [], total: 60, max: 100, issues },
    ...over,
  }
}

function ev(id: string, at: string, correct: boolean): AnswerEvent {
  return {
    at,
    day: at.slice(0, 10),
    articleId: 'a1',
    source: 'golden',
    kind: 'error-fix',
    cat: 'write',
    correct,
    questionId: id,
  }
}

describe('collectWritingErrorCards', () => {
  it('只取 v2 must-fix；同 rule+key 只留最新一条', () => {
    const cards = collectWritingErrorCards(
      [
        rec('2026-10-30T10:00:00.000Z', [
          issue('word-spelling', 'spelling-bureaucracy', 'must-fix', { original: 'bureacracy', suggestion: 'bureaucracy' }),
          issue('literal-translation', 'literal-x', 'improvement'),
        ]),
        rec('2026-10-29T10:00:00.000Z', [
          issue('word-spelling', 'spelling-bureaucracy', 'must-fix', { original: 'bureacracy', suggestion: 'bureaucracy' }),
        ]),
      ],
      { scope: 'all', now },
    )
    expect(cards).toHaveLength(1)
    expect(cards[0]).toMatchObject({ id: 'errfix:word-spelling|spelling-bureaucracy', original: 'bureacracy' })
    expect(cards[0].text).toContain('bureacracy')
  })

  it('按篇 / 时间过滤', () => {
    const cards = collectWritingErrorCards(
      [
        rec('2026-10-30T10:00:00.000Z', [issue('tense-choice', 'tense-choice')]),
        rec('2026-10-01T10:00:00.000Z', [issue('chunk-sense', 'chunk-x')]),
        rec('2026-10-30T10:00:00.000Z', [issue('word-spelling', 'spelling-x')], { articleId: 'a2' }),
      ],
      { scope: 'article', articleId: 'a1', sinceDays: 7, now },
    )
    expect(cards.map((c) => c.key)).toEqual(['tense-choice'])
  })
})

describe('errorFixExamItem', () => {
  it('用改正后的整句做参照，题面只让学生订正片段', () => {
    const card = collectWritingErrorCards(
      [rec('2026-10-30T00:00:00.000Z', [
        issue('word-spelling', 'spelling-bureaucracy', 'must-fix', {
          original: 'bureacracy',
          suggestion: 'bureaucracy',
        }),
      ], { sentenceId: 's1' })],
      { scope: 'all', now },
    )[0]
    const item = errorFixExamItem(card)
    expect(item).toMatchObject({
      id: card.id,
      sentenceId: 's1',
      model: 'I learn bureaucracy.',
      source: 'local',
      mustUse: [],
    })
    expect(item.task).toContain('bureacracy')
    expect(item.task).toContain('不要要求重写整句')
    expect(item.focus).toContain('bureacracy')
  })
})

describe('writingErrorReviewSchedule / states', () => {
  it('没有复习 → 现在到期；答错 → 1 天后；连对 6 次掌握', () => {
    expect(writingErrorReviewSchedule(undefined)).toEqual({ dueAt: null, mastered: false })
    expect(writingErrorReviewSchedule({ id: 'x', lastAt: '2026-10-31T00:00:00.000Z', lastCorrect: false, streak: 0, reviews: 1 })).toEqual({
      dueAt: '2026-11-01T00:00:00.000Z',
      mastered: false,
    })
    expect(writingErrorReviewSchedule({ id: 'x', lastAt: '2026-10-31T00:00:00.000Z', lastCorrect: true, streak: 1, reviews: 1 })).toEqual({
      dueAt: '2026-11-03T00:00:00.000Z',
      mastered: false,
    })
    expect(writingErrorReviewSchedule({ id: 'x', lastAt: '2026-10-31T00:00:00.000Z', lastCorrect: true, streak: 6, reviews: 6 })).toEqual({
      dueAt: null,
      mastered: true,
    })
  })

  it('事件按时间归并；答错把 streak 归零', () => {
    const id = writingErrorCardId('word-spelling', 'spelling-x')
    const states = writingErrorReviewStates([
      ev(id, '2026-10-01T00:00:00.000Z', true),
      ev(id, '2026-10-02T00:00:00.000Z', true),
      ev(id, '2026-10-03T00:00:00.000Z', false),
    ])
    expect(states.get(id)).toMatchObject({ streak: 0, reviews: 3, lastCorrect: false })
  })
})

describe('dueWritingErrorCards / answer check', () => {
  it('从未练的排前；未到期 / 已掌握不出现', () => {
    const cards = [
      { ...collectWritingErrorCards([rec('2026-10-30T00:00:00.000Z', [issue('tense-choice', 'tense-choice')])], { scope: 'all', now })[0] },
      { ...collectWritingErrorCards([rec('2026-10-30T00:00:00.000Z', [issue('word-spelling', 'spelling-x')])], { scope: 'all', now })[0] },
    ]
    const id = cards[1].id
    const due = dueWritingErrorCards(cards, [ev(id, '2026-10-31T00:00:00.000Z', true)], now)
    expect(due.map((c) => c.id)).toEqual([cards[0].id])
    const none = dueWritingErrorCards(cards, [ev(id, '2026-10-31T00:00:00.000Z', true)], new Date('2026-11-01T00:00:00.000Z'))
    // 11-01 还没到 +3 天；练过的那张不在，另一张从没练过仍在。
    expect(none.map((c) => c.id)).toEqual([cards[0].id])
  })

  it('大小写规则区分大小写，其余忽略大小写 / 首尾标点', () => {
    const cap = collectWritingErrorCards(
      [rec('2026-10-30T00:00:00.000Z', [issue('sentence-initial-capital', 'sentence-initial-capital', 'must-fix', { suggestion: 'This is a test.' })])],
      { scope: 'all', now },
    )[0]
    expect(isWritingErrorAnswerCorrect('This is a test', cap)).toBe(true)
    expect(isWritingErrorAnswerCorrect('this is a test', cap)).toBe(false)
    const spell = collectWritingErrorCards(
      [rec('2026-10-30T00:00:00.000Z', [issue('word-spelling', 'spelling-bureaucracy', 'must-fix', { suggestion: 'bureaucracy' })])],
      { scope: 'all', now },
    )[0]
    expect(isWritingErrorAnswerCorrect(' Bureaucracy. ', spell)).toBe(true)
  })
})
