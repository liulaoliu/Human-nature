import { describe, it, expect } from 'vitest'
import {
  ANSWER_EVENT_CAP,
  addAnswerEvent,
  answerEventsToActivity,
  answerEventsToKindStats,
  createAnswerEvent,
  normalizeAnswerEvents,
  type AnswerEvent,
} from './answerEvents'

const ev = (patch: Partial<AnswerEvent> = {}): AnswerEvent => ({
  at: '2026-10-20T10:00:00.000Z',
  day: '2026-10-20',
  articleId: 'art-A',
  source: 'quiz',
  kind: 'cloze',
  cat: 'vocab',
  correct: true,
  ...patch,
})

describe('normalizeAnswerEvents', () => {
  it('保留合法事件，坏条目丢弃', () => {
    const out = normalizeAnswerEvents([
      ev(),
      ev({ correct: false, questionId: 'q1' }),
      null,
      'x',
      ev({ at: 'not-a-date' }),
      ev({ source: 'unknown' as never }),
      ev({ kind: '  ' }),
      ev({ cat: 'dance' as never }),
      { ...ev(), correct: 'yes' },
    ])
    expect(out).toHaveLength(2)
    expect(out[1]).toMatchObject({ correct: false, questionId: 'q1' })
  })

  it('非数组原样丢弃；缺 articleId 补空串', () => {
    expect(normalizeAnswerEvents(null)).toEqual([])
    expect(normalizeAnswerEvents({})).toEqual([])
    expect(normalizeAnswerEvents([{ ...ev(), articleId: undefined }])[0].articleId).toBe('')
  })

  it('questionId 为空串时不写', () => {
    expect(normalizeAnswerEvents([ev({ questionId: '' })])[0]).not.toHaveProperty('questionId')
  })
})

describe('createAnswerEvent', () => {
  it('没给时间就用 now；给了就原样保留', () => {
    const now = new Date('2026-10-20T12:34:56.000Z')
    expect(createAnswerEvent(ev({ at: undefined, day: undefined }), now)).toMatchObject({
      at: now.toISOString(),
      day: '2026-10-20',
    })
    expect(createAnswerEvent(ev({ at: '2026-01-01T00:00:00.000Z', day: undefined }), now).day).toBe('2026-01-01')
  })
})

describe('addAnswerEvent', () => {  it('追加并保留最近 cap 条', () => {
    const list = Array.from({ length: 3 }, (_, i) => ev({ questionId: `q${i}` }))
    const out = addAnswerEvent(list, ev({ questionId: 'q3' }), 3)
    expect(out.map((e) => e.questionId)).toEqual(['q1', 'q2', 'q3'])
  })

  it('默认上限是 ANSWER_EVENT_CAP', () => {
    const list = Array.from({ length: ANSWER_EVENT_CAP }, (_, i) => ev({ questionId: `q${i}` }))
    const out = addAnswerEvent(list, ev({ questionId: 'last' }))
    expect(out).toHaveLength(ANSWER_EVENT_CAP)
    expect(out[out.length - 1].questionId).toBe('last')
    expect(out[0].questionId).toBe('q1')
  })
})

describe('answerEventsToKindStats', () => {
  it('只统计考试题，按文章 + 题型累计', () => {
    const stats = answerEventsToKindStats([
      ev({ kind: 'cloze', correct: true }),
      ev({ kind: 'cloze', correct: false }),
      ev({ kind: 'spell', correct: true }),
      ev({ source: 'dictation', kind: 'dictation', cat: 'listen' }),
      ev({ articleId: '', kind: 'usage' }),
    ])
    expect(stats).toEqual({
      'art-A': {
        cloze: { total: 2, correct: 1 },
        spell: { total: 1, correct: 1 },
      },
    })
  })
})

describe('answerEventsToActivity', () => {
  it('按本地结算日累计分类，同一天合并', () => {
    const out = answerEventsToActivity([
      ev({ at: '2026-10-20T10:00:00', cat: 'vocab' }),
      ev({ at: '2026-10-20T11:00:00', cat: 'vocab' }),
      ev({ at: '2026-10-20T12:00:00', cat: 'read' }),
      ev({ at: '2026-10-19T12:00:00', day: '2026-10-19', cat: 'listen' }),
    ])
    expect(out).toEqual([
      { day: '2026-10-19', counts: { listen: 1 } },
      { day: '2026-10-20', counts: { vocab: 2, read: 1 } },
    ])
  })

  it('凌晨 4 点前算前一天（与 dayKeyLocal 一致）', () => {
    const out = answerEventsToActivity([ev({ at: '2026-10-20T02:00:00', day: '2026-10-19' })])
    expect(out[0].day).toBe('2026-10-19')
  })
})
