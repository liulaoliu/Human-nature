import { describe, it, expect } from 'vitest'
import {
  buildImitationTaskPrompt,
  buildWritingFeedbackPrompt,
  parseImitationTask,
  parseWritingFeedback,
  type ImitationTask,
} from './writing'

describe('buildImitationTaskPrompt', () => {
  it('含范句、rubric、必须用上的词、JSON schema', () => {
    const p = buildImitationTaskPrompt({
      model: 'The more we learn, the less we know.',
      structure: 'the more… the more…',
      mustUse: ['the more', 'the less'],
    })
    expect(p).toContain('The more we learn, the less we know.')
    expect(p).toContain('the more')
    expect(p).toContain('"rubric"')
  })
})

describe('parseImitationTask', () => {
  it('解析合法 JSON（含栅欄）', () => {
    const raw =
      '```json\n{"task":"写 3 句","model":"M","structure":"S","mustUse":["a","b"],"rubric":[{"dimension":"语法","weight":40,"description":"..."}]}\n```'
    const t = parseImitationTask(raw)
    expect(t).toMatchObject({ task: '写 3 句', model: 'M', mustUse: ['a', 'b'] })
    expect(t?.rubric[0]).toMatchObject({ dimension: '语法', weight: 40 })
  })
  it('缺 task/model → null', () => {
    expect(parseImitationTask(JSON.stringify({ task: 'x' }))).toBeNull()
    expect(parseImitationTask('not json')).toBeNull()
  })
})

describe('buildWritingFeedbackPrompt', () => {
  const task: ImitationTask = {
    task: '写 3 句',
    model: 'M',
    mustUse: ['a'],
    rubric: [{ dimension: '语法准确', weight: 40 }],
  }
  it('含严格规则、评分标准、学生作答、JSON schema', () => {
    const p = buildWritingFeedbackPrompt(task, 'I go to school yesterday.')
    expect(p).toContain('不要客套')
    expect(p).toContain('语法准确（满分 40）')
    expect(p).toContain('I go to school yesterday.')
    expect(p).toContain('"polished"')
  })
})

describe('parseWritingFeedback', () => {
  it('解析分数 + issues + polished', () => {
    const raw = JSON.stringify({
      scores: [{ dimension: '语法准确', score: 30, max: 40, comment: '时态错' }],
      total: 30,
      max: 40,
      issues: [{ original: 'go', suggestion: 'went', reason: '过去时间用过去式' }],
      polished: 'I went to school yesterday.',
      summary: '注意时态。',
    })
    const f = parseWritingFeedback(raw)
    expect(f?.total).toBe(30)
    expect(f?.issues[0]).toMatchObject({ original: 'go', suggestion: 'went' })
    expect(f?.polished).toContain('went')
  })
  it('没有 scores/issues → null；非法 JSON → null', () => {
    expect(parseWritingFeedback(JSON.stringify({ summary: 'x' }))).toBeNull()
    expect(parseWritingFeedback('nope')).toBeNull()
  })
})
