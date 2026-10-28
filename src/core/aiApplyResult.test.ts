import { describe, expect, it, vi } from 'vitest'
import type { AiJob } from './aiJobTypes'
import { applyAiResults } from './aiApplyResult'

function job(id: string, task: AiJob['task'], over: Partial<AiJob> = {}): AiJob {
  return { id, task, label: `label-${id}`, askedWords: ['w1'], askedIds: [], prompt: '', ...over }
}

describe('applyAiResults', () => {
  it('按 id 找回任务，统计成功/失败并拼报告', () => {
    const apply = vi.fn((task: string | null) =>
      task === 'translate' ? { ok: false, report: ['格式不对'] } : { ok: true, report: ['已写入'] },
    )
    const out = applyAiResults(
      [
        { id: 'a1', raw: 'x' },
        { id: 'b1', raw: 'y' },
        { id: 'missing', raw: 'z' },
      ],
      [job('a1', 'lookup'), job('b1', 'translate')],
      apply as never,
    )
    expect(out).toMatchObject({ okCount: 1, failCount: 2, appliedIds: ['a1'], autoVocab: false })
    expect(out.lines).toEqual(['【label-a1】已写入', '【label-b1】格式不对', '跳过：找不到任务（id=missing）'])
  })

  it('id 对不上时允许用结果里的 task/askedWords 兜底', () => {
    const apply = vi.fn(() => ({ ok: true, report: ['ok'] }))
    const out = applyAiResults(
      [{ id: 'gone', task: 'lookup', askedWords: ['alpha'], raw: 'x' }],
      [],
      apply as never,
    )
    expect(apply).toHaveBeenCalledWith('lookup', 'x', ['alpha'], [], undefined)
    expect(out).toMatchObject({ okCount: 1, appliedIds: [], autoVocab: false })
  })

  it('未知任务直接跳过；只有成功应用 auto_vocab 才置 autoVocab', () => {
    const apply = vi.fn((task: string | null) => ({ ok: task !== 'auto_vocab', report: ['r'] }))
    const failedAuto = applyAiResults([{ id: 'a1', raw: 'x' }], [job('a1', 'auto_vocab')], apply as never)
    expect(failedAuto.autoVocab).toBe(false)

    const odd = applyAiResults([{ id: 'x', raw: 'x' }], [], apply as never)
    expect(odd.lines[0]).toContain('找不到任务')
  })

  it('把任务的 articleKey 作为 meta 传下去', () => {
    const apply = vi.fn(() => ({ ok: true, report: ['ok'] }))
    applyAiResults([{ id: 'a1', raw: 'x' }], [job('a1', 'golden', { articleKey: 'sig-1' })], apply as never)
    expect(apply).toHaveBeenCalledWith('golden', 'x', ['w1'], [], { articleKey: 'sig-1' })
  })
})
