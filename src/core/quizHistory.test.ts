import { describe, expect, it } from 'vitest'
import type { QuizQuestion } from './quiz'
import { pickFreshQuestions, questionHistoryKey } from './quizHistory'

function q(over: Partial<QuizQuestion> = {}): QuizQuestion {
  return {
    id: 'v1:spell',
    itemId: 'v1',
    lemma: 'run',
    kind: 'spell',
    source: 'vocab',
    word: 'run',
    prompt: '跑',
    meaning: '跑',
    partOfSpeech: null,
    phonetic: null,
    answer: 'run',
    accept: ['run'],
    ...over,
  }
}

describe('questionHistoryKey：下一轮怎么判断「考过」', () => {
  it('词级按词条去重：同一个词换题型也算考过', () => {
    expect(questionHistoryKey(q({ id: 'v1:spell' }))).toBe('vocab:v1')
    expect(questionHistoryKey(q({ id: 'v1:meaning', kind: 'meaning' }))).toBe('vocab:v1')
  })

  it('文章级按题目去重：同一句的另一种题型算新题', () => {
    expect(
      questionHistoryKey(
        q({ id: 'article:translate:s1', itemId: 's1', source: 'article', kind: 'translate' }),
      ),
    ).toBe('article:translate:s1')
    expect(
      questionHistoryKey(
        q({ id: 'article:grammar:s1', itemId: 's1', source: 'article', kind: 'grammar' }),
      ),
    ).toBe('article:grammar:s1')
  })
})

describe('pickFreshQuestions：跳过考过的题，再按本轮数量取', () => {
  const items = [
    q({ id: 'v1:spell', itemId: 'v1' }),
    q({ id: 'v2:spell', itemId: 'v2' }),
    q({ id: 'v3:spell', itemId: 'v3' }),
    q({ id: 'v4:spell', itemId: 'v4' }),
  ]

  it('没考过时全部可选；limit 封顶', () => {
    const all = pickFreshQuestions(items, new Set(), 0)
    expect(all.picked).toHaveLength(4)
    expect(all.fresh).toBe(4)

    const two = pickFreshQuestions(items, new Set(), 2)
    expect(two.picked).toHaveLength(2)
    expect(two.fresh).toBe(4)
  })

  it('同一个词换题型也跳过（词级按 itemId 去重）', () => {
    const seen = new Set(['vocab:v1'])
    const picked = pickFreshQuestions(
      [q({ id: 'v1:meaning', itemId: 'v1', kind: 'meaning' }), q({ id: 'v2:spell', itemId: 'v2' })],
      seen,
      5,
    )
    expect(picked.picked.map((x) => x.itemId)).toEqual(['v2'])
    expect(picked.fresh).toBe(1)
  })

  it('新题不够：只返回剩下的，不拿旧题凑数', () => {
    const seen = new Set(['vocab:v1', 'vocab:v2', 'vocab:v3'])
    const picked = pickFreshQuestions(items, seen, 10)
    expect(picked.picked).toHaveLength(1)
    expect(picked.picked[0].itemId).toBe('v4')
    expect(picked.fresh).toBe(1)
  })

  it('全考过：返回空，fresh = 0', () => {
    const seen = new Set(items.map(questionHistoryKey))
    expect(pickFreshQuestions(items, seen, 10)).toEqual({ picked: [], fresh: 0 })
  })
})
