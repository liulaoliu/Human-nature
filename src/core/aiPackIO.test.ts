import { describe, it, expect } from 'vitest'
import {
  AI_RESULT_FORMAT_INSTRUCTIONS,
  buildJobPack,
  makeJobId,
  normalizeAiResults,
  parseAiResultPack,
  parseJobPack,
} from './aiPackIO'
import type { AiJob } from './aiJobTypes'

const job = (over: Partial<AiJob> = {}): AiJob => ({
  id: 'lookup-abc',
  task: 'lookup',
  label: '查词（1）',
  askedWords: ['run'],
  askedIds: [],
  prompt: 'p',
  ...over,
})

describe('aiPackIO 包的读写', () => {
  it('normalizeAiResults 认 raw / text / content，丢弃空条目', () => {
    const out = normalizeAiResults([
      { id: 'a', raw: 'ok' },
      { id: 'b', text: 'from text' },
      { id: 'c', content: 'from content' },
      { id: 'd', raw: '   ' },
      { id: 'e' },
      null,
      'str',
    ])
    expect(out.results.map((r) => [r.id, r.raw])).toEqual([
      ['a', 'ok'],
      ['b', 'from text'],
      ['c', 'from content'],
    ])
    expect(out.dropped).toBe(4)
    expect(normalizeAiResults(null)).toEqual({ results: [], dropped: 0 })
    expect(normalizeAiResults({})).toEqual({ results: [], dropped: 1 })
  })

  it('normalizeAiResults 保留合法的 task / askedWords / askedIds', () => {
    const [r] = normalizeAiResults([{ id: 'a', raw: 'x', task: 'lookup', askedWords: ['w', 3], askedIds: ['s1'] }]).results
    expect(r.task).toBe('lookup')
    expect(r.askedWords).toEqual(['w'])
    expect(r.askedIds).toEqual(['s1'])
  })

  it('parseAiResultPack 支持 results 包装 / 裸数组 / 单条对象', () => {
    expect(parseAiResultPack('{"results":[{"id":"a","raw":"x"}]}').results).toHaveLength(1)
    expect(parseAiResultPack('[{"id":"a","raw":"x"}]').results).toHaveLength(1)
    expect(parseAiResultPack('{"id":"a","raw":"x"}').results).toHaveLength(1)
  })

  it('parseAiResultPack 的错误信息分得清「不是 JSON」和「缺 results」', () => {
    expect(parseAiResultPack('not json').error).toBe('不是合法 JSON')
    expect(parseAiResultPack('{"foo":1}').error).toBe('缺少 results 数组')
    expect(parseAiResultPack('{"results":[]}').error).toBe('没有有效的 raw 文本')
  })

  it('makeJobId 稳定且区分任务', () => {
    expect(makeJobId('lookup', 'a|run')).toBe(makeJobId('lookup', 'a|run'))
    expect(makeJobId('lookup', 'a|run')).not.toBe(makeJobId('lookup', 'a|dog'))
    expect(makeJobId('lookup', 'a|run')).not.toBe(makeJobId('phrase', 'a|run'))
    expect(makeJobId('lookup', 'a|run')).toMatch(/^lookup-[a-z0-9]+$/)
  })

  it('buildJobPack 带上格式说明与导出时间', () => {
    const pack = buildJobPack([job()], new Date('2026-10-02T00:00:00.000Z'))
    expect(pack.version).toBe(1)
    expect(pack.exportedAt).toBe('2026-10-02T00:00:00.000Z')
    expect(pack.instructions).toBe(AI_RESULT_FORMAT_INSTRUCTIONS)
    expect(pack.jobs).toHaveLength(1)
  })

  it('parseJobPack 跳过非法任务，全非法返回 null', () => {
    const ok = parseJobPack(
      JSON.stringify({
        exportedAt: '2026-10-02',
        jobs: [
          { id: 'a', task: 'lookup', prompt: 'p' },
          { id: 'b', task: 'nope' },
          { id: 'c' },
        ],
      }),
    )
    expect(ok?.jobs).toHaveLength(1)
    expect(ok?.jobs[0].label).toBe('lookup') // 没 label 时退回任务名
    expect(parseJobPack('{"jobs":[{"id":"x","task":"nope"}]}')).toBeNull()
    expect(parseJobPack('{"jobs":[]}')).toBeNull()
    expect(parseJobPack('bad')).toBeNull()
  })
})
