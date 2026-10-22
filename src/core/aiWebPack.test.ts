import { describe, it, expect } from 'vitest'
import {
  WEB_ANSWER_TAG,
  WEB_END_TAG,
  buildWebPackPrompt,
  missingJobIds,
  parseWebPackResults,
} from './aiWebPack'
import type { AiJob } from './aiJobTypes'

const job = (id: string, over: Partial<AiJob> = {}): AiJob => ({
  id,
  task: 'lookup',
  label: '查词',
  askedWords: [],
  askedIds: [],
  prompt: `prompt for ${id}`,
  ...over,
})

describe('aiWebPack 网页版打包', () => {
  it('提示词列出每个任务与分隔符说明', () => {
    const p = buildWebPackPrompt([job('lookup-a'), job('phrase-b')])
    expect(p).toContain('共 2 个任务')
    expect(p).toContain(`${WEB_ANSWER_TAG} 任务id`)
    expect(p).toContain('----- 任务 lookup-a（lookup · 查词）-----')
    expect(p).toContain('prompt for phrase-b')
    expect(p).toContain('===== 任务开始 =====')
    expect(p).toContain('===== 任务结束 =====')
  })

  it('分批时说明是第几批，并提示剩余数量', () => {
    const p = buildWebPackPrompt([job('a')], { batchIndex: 2, batchCount: 3, remaining: 7 })
    expect(p).toContain('第 2 / 3 批')
    expect(p).toContain('还有 7 个任务')
  })

  it('按 @@@ANSWER 切分，去掉 @@@END 与代码围栏', () => {
    const text = [
      '开场白（应被丢弃）',
      `${WEB_ANSWER_TAG} lookup-a`,
      '```text',
      'run | /rʌn/ | v.',
      '```',
      WEB_END_TAG,
      `${WEB_ANSWER_TAG} phrase-b`,
      'run out — 用完',
    ].join('\n')
    const out = parseWebPackResults(text)
    expect(out.map((r) => r.id)).toEqual(['lookup-a', 'phrase-b'])
    expect(out[0].raw).toBe('run | /rʌn/ | v.')
    expect(out[1].raw).toBe('run out — 用完')
  })

  it('容忍 > 引用符、星号与空格写法的标记行', () => {
    const out = parseWebPackResults(`> **@@@ ANSWER lookup-a**\nanswer`)
    expect(out).toEqual([{ id: 'lookup-a', raw: 'answer' }])
  })

  it('没有分隔符时退回 JSON 结果包', () => {
    const out = parseWebPackResults('{"results":[{"id":"a","raw":"x"}]}')
    expect(out).toEqual([{ id: 'a', raw: 'x' }])
  })

  it('截断时 missingJobIds 给出没答的 id', () => {
    const jobs = [job('a'), job('b'), job('c')]
    expect(missingJobIds(jobs, [{ id: 'a' }])).toEqual(['b', 'c'])
    expect(missingJobIds(jobs, jobs.map((j) => ({ id: j.id })))).toEqual([])
  })

  it('空回复不产生条目', () => {
    expect(parseWebPackResults('')).toEqual([])
    expect(parseWebPackResults(`${WEB_ANSWER_TAG} a\n   \n`)).toEqual([])
  })
})
