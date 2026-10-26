import { describe, expect, it } from 'vitest'
import { emptyLearning, hasLearningData, LEARNING_KEYS, LEARNING_SECTIONS, normalizeLearning } from './learning'

describe('learning 记录', () => {
  it('LEARNING_KEYS 与 LEARNING_SECTIONS 一一对应，键名不重复', () => {
    const keys = Object.keys(LEARNING_KEYS).sort()
    expect([...LEARNING_SECTIONS].sort()).toEqual(keys)
    const storageKeys = Object.values(LEARNING_KEYS)
    expect(new Set(storageKeys).size).toBe(storageKeys.length)
    for (const key of storageKeys) expect(key.startsWith('reader:')).toBe(true)
  })

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
      answerEvents: [
        {
          at: '2026-01-01T00:00:00.000Z',
          day: '2026-01-01',
          articleId: 'a1',
          source: 'quiz',
          kind: 'cloze',
          cat: 'vocab',
          correct: true,
        },
        { at: 'bad', source: 'quiz', kind: 'cloze', cat: 'vocab', correct: true },
      ],
    })
    expect(data.practice).toHaveLength(1)
    expect(data.mistakes).toHaveLength(1)
    expect(data.readDone).toHaveLength(1)
    expect(data.studiedDays).toEqual([{ day: '2026-01-01', ids: ['w1', 'w2'] }])
    expect(data.skimmed).toEqual(['a1'])
    expect(data.kindStats).toEqual({ a1: { quiz: { total: 10, correct: 8 } } })
    expect(data.answerEvents).toHaveLength(1)
    expect(hasLearningData(data)).toBe(true)
  })

  it('数值字段坏了也丢弃，不让 NaN 进统计', () => {
    const data = normalizeLearning({
      practice: [{ at: '2026-01-01T00:00:00.000Z', kind: 'quiz', total: 'x', correct: 1 }],
      mistakes: [{ id: 'm1', kind: 'vocab', at: '2026-01-01T00:00:00.000Z', count: 'x', label: 'm1' }],
      studyDays: [{ day: '2026-01-01', seconds: 'x', cards: 1 }],
      sessions: [{ at: '2026-01-01T00:00:00.000Z', seconds: 1, picked: 'x' }],
      activity: [{ day: '2026-01-01', counts: { read: 'x', speak: 2 } }],
    })
    expect(data.practice).toHaveLength(0)
    expect(data.mistakes).toHaveLength(0)
    expect(data.studyDays).toHaveLength(0)
    expect(data.sessions).toHaveLength(0)
    expect(data.activity).toEqual([{ day: '2026-01-01', counts: { speak: 2 } }])
    expect(hasLearningData(data)).toBe(true)
  })

  it('回译存档也按学习记录校验：坏条目丢掉，好记录保留', () => {
    const good = {
      id: 'bt1',
      at: '2026-10-01T00:00:00.000Z',
      articleId: 'a1',
      sentenceId: 's1',
      sourceZh: '他去了学校。',
      answer: 'He went to school.',
      reference: 'He went to school.',
      feedback: { scores: [{ dimension: '意思还原', score: 36, max: 40 }], issues: [], alternatives: [] },
      closeness: { exact: true, ratio: 1 },
    }
    const data = normalizeLearning({
      backTranslations: [good, { ...good, id: 'bad', sourceZh: '' }],
    })
    expect(data.backTranslations).toHaveLength(1)
    expect(data.backTranslations[0].id).toBe('bt1')
    expect(hasLearningData({ ...emptyLearning(), backTranslations: data.backTranslations })).toBe(true)
  })

  it('只有事件也算有学习数据', () => {
    const data = normalizeLearning({
      answerEvents: [
        {
          at: '2026-01-01T00:00:00.000Z',
          day: '2026-01-01',
          articleId: 'a1',
          source: 'quiz',
          kind: 'cloze',
          cat: 'vocab',
          correct: true,
        },
      ],
    })
    expect(hasLearningData(data)).toBe(true)
  })

  it('只有偏好/空记录时 hasLearningData=false', () => {
    expect(hasLearningData(emptyLearning())).toBe(false)
  })
})
