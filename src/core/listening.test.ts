import { describe, it, expect } from 'vitest'
import {
  buildListeningQuizPrompt,
  gradeListening,
  isListeningCorrect,
  parseListeningQuiz,
  type ListeningQuestion,
} from './listening'

describe('buildListeningQuizPrompt', () => {
  it('含题量、严格规则、JSON schema 与原文', () => {
    const p = buildListeningQuizPrompt('Hello world.', { count: 5 })
    expect(p).toContain('共出 5 道题')
    expect(p).toContain('有且只有一个')
    expect(p).toContain('"questions"')
    expect(p).toContain('Hello world.')
  })
  it('默认 8 题', () => {
    expect(buildListeningQuizPrompt('x')).toContain('共出 8 道题')
  })
})

describe('parseListeningQuiz（严格校验）', () => {
  it('解析合法 JSON（含代码栅欄）', () => {
    const raw = '```json\n{"questions":[{"id":"q1","type":"mcq","stem":"S","options":["a","b"],"answer":"a","explanation":"e"},{"type":"gap","stem":"x ____ y","answer":"z"}]}\n```'
    const q = parseListeningQuiz(raw)
    expect(q.questions).toHaveLength(2)
    expect(q.questions[0]).toMatchObject({ id: 'q1', type: 'mcq', answer: 'a' })
    expect(q.questions[1]).toMatchObject({ type: 'gap', answer: 'z' })
  })
  it('丢弃不合格的题：缺答案 / 单选选项不足 / 答案不在选项里', () => {
    const raw = JSON.stringify({
      questions: [
        { type: 'mcq', stem: 'ok', options: ['a', 'b'], answer: 'a' },
        { type: 'mcq', stem: 'no options', options: ['a'], answer: 'a' },
        { type: 'mcq', stem: 'answer not in options', options: ['a', 'b'], answer: 'c' },
        { type: 'gap', stem: 'x', answer: '' },
      ],
    })
    expect(parseListeningQuiz(raw).questions).toHaveLength(1)
  })
  it('非法 JSON → 空', () => {
    expect(parseListeningQuiz('not json').questions).toEqual([])
  })
})

describe('isListeningCorrect / gradeListening', () => {
  const mcq: ListeningQuestion = { id: 'm', type: 'mcq', stem: 's', options: ['A', 'B'], answer: 'A' }
  const gap: ListeningQuestion = { id: 'g', type: 'gap', stem: 'x ____ y', answer: 'prices', accept: ['the prices'] }

  it('mcq 需完全一致', () => {
    expect(isListeningCorrect(mcq, 'A')).toBe(true)
    expect(isListeningCorrect(mcq, 'B')).toBe(false)
  })
  it('gap 忽略大小写 / 标点，且接受 accept', () => {
    expect(isListeningCorrect(gap, 'Prices.')).toBe(true)
    expect(isListeningCorrect(gap, 'the prices')).toBe(true)
    expect(isListeningCorrect(gap, 'costs')).toBe(false)
  })
  it('gradeListening 汇总', () => {
    const r = gradeListening([mcq, gap], { m: 'A', g: 'costs' })
    expect(r.correct).toBe(1)
    expect(r.total).toBe(2)
    expect(r.score).toBeCloseTo(0.5, 5)
  })
})
