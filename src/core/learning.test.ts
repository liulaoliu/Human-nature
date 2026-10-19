import { describe, expect, it } from 'vitest'
import { emptyLearning, hasLearningData, normalizeLearning } from './learning'

describe('learning 记录', () => {
  it('空值 / 坏值给空记录，不抛', () => {
    expect(normalizeLearning(null)).toEqual(emptyLearning())
    expect(normalizeLearning('nope')).toEqual(emptyLearning())
    expect(normalizeLearning({ practice: 'bad', activity: [{}] })).toEqual(emptyLearning())
  })

  it('只保留结构正确的记录', () => {
    const data = normalizeLearning({
      practice: [
        { at: '2026-01-01T00:00:00.000Z', kind: 'quiz', total: 10, correct: 8 },
        { kind: 'quiz' },
      ],
      mistakes: [{ id: 'vocab:w1', kind: 'vocab', at: '2026-01-01T00:00:00.000Z', count: 2, label: 'w1' }],
      readDone: [{ day: '2026-01-01', articleId: 'a1', title: 'A', at: '2026-01-01T00:00:00.000Z' }],
      studiedDays: [{ day: '2026-01-01', ids: ['w1', 2, 'w2'] }],
      skimmed: ['a1', '', 3],
      kindStats: { a1: { quiz: { total: 10, correct: 8 }, bad: { total: 'x' } } },
    })
    expect(data.practice).toHaveLength(1)
    expect(data.mistakes).toHaveLength(1)
    expect(data.readDone).toHaveLength(1)
    expect(data.studiedDays).toEqual([{ day: '2026-01-01', ids: ['w1', 'w2'] }])
    expect(data.skimmed).toEqual(['a1'])
    expect(data.kindStats).toEqual({ a1: { quiz: { total: 10, correct: 8 } } })
    expect(hasLearningData(data)).toBe(true)
  })

  it('只有偏好/空记录时 hasLearningData=false', () => {
    expect(hasLearningData(emptyLearning())).toBe(false)
  })
})
