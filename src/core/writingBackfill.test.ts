import { describe, it, expect } from 'vitest'
import { upgradeWritingFeedback, upgradeWritingIssue } from './writingBackfill'

describe('writingBackfill：旧批改 → v2 纯映射', () => {
  it('补 rule/key/severity/type', () => {
    const up = upgradeWritingFeedback(
      JSON.stringify({
        scores: [{ dimension: '语法', score: 1, max: 2 }],
        issues: [{ original: 'bureacracy', suggestion: 'bureaucracy', reason: '拼写错误' }],
      }),
    )
    expect(up?.feedback.version).toBe(2)
    expect(up?.feedback.issues[0]).toMatchObject({
      rule: 'word-spelling',
      key: 'spelling-bureaucracy',
      type: 'spelling',
      severity: 'must-fix',
    })
    expect(up?.feedback.recommendations).toEqual([])
    expect(up?.inferred).toBe(1)
  })

  it('已经是 v2 / 坏 JSON → null', () => {
    expect(upgradeWritingFeedback({ version: 2, issues: [] })).toBeNull()
    expect(upgradeWritingFeedback('not json')).toBeNull()
    expect(upgradeWritingFeedback(null)).toBeNull()
  })

  it('缺 suggestion 的旧 issue 丢弃并计数', () => {
    const up = upgradeWritingFeedback({ issues: [{ original: 'x' }, { suggestion: 'y' }] })
    expect(up?.feedback.issues).toHaveLength(1)
    expect(up?.dropped).toBe(1)
  })

  it('已有合法 rule/key 不重复推断', () => {
    const up = upgradeWritingIssue({
      original: 'x',
      suggestion: 'y',
      rule: 'chunk-sense',
      key: 'chunk-y',
      severity: 'must-fix',
    })
    expect(up.inferred).toBe(false)
    expect(up.issue.type).toBe('chunk')
  })
})
