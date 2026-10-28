import { describe, expect, it } from 'vitest'
import type { AiJob, AiJobTask } from './aiJobTypes'
import { aiNextHint, buildAiBreakdown, buildAiChecklist } from './aiProgress'

function job(id: string, task: AiJobTask, askedWords: string[] = []): AiJob {
  return { id, task, label: id, askedWords, askedIds: [], prompt: '' }
}

describe('AI 进度纯派生', () => {
  it('按任务首次出现顺序分组，并只把当前轮里的 id 算完成', () => {
    const round = [job('a1', 'lookup'), job('b1', 'translate'), job('a2', 'lookup')]
    const out = buildAiBreakdown(round, new Set(['a1', 'b1', 'stale']))
    expect(out.map((x) => x.task)).toEqual(['lookup', 'translate'])
    expect(out[0]).toMatchObject({ done: 1, total: 2, label: '查词/补齐' })
    expect(out[1]).toMatchObject({ done: 1, total: 1 })
  })

  it('待选批次会作为人工步骤追加，不混进 AI 任务完成数', () => {
    const breakdown = buildAiBreakdown([job('a1', 'lookup')], new Set(['a1']))
    const checklist = buildAiChecklist(breakdown, 3)
    expect(checklist).toHaveLength(2)
    expect(checklist[1]).toMatchObject({ key: 'commitBatch', done: 0, total: 1, manual: true })
    expect(buildAiChecklist(breakdown, 0)).toHaveLength(1)
  })

  it('下一步提示按优先级：待选 > 跑批中 > 待办 > 跑完缺口 > 已自动标词 > 全完成', () => {
    const base = {
      batchCount: 2,
      running: true,
      round: 1,
      phase: '查词',
      done: 3,
      total: 10,
      pending: [job('a1', 'lookup', ['alpha', 'beta'])],
      roundCount: 4,
      autoVocabDone: true,
      batchName: '一键跑批',
    }
    expect(aiNextHint(base)).toContain('待选有 2 个词')
    expect(aiNextHint({ ...base, batchCount: 0 })).toContain('第 1 轮')
    expect(aiNextHint({ ...base, batchCount: 0, running: false })).toContain('还有 1 项待办')
    expect(aiNextHint({ ...base, batchCount: 0, running: false, pending: [] })).toContain('本轮已跑完')
    expect(aiNextHint({ ...base, batchCount: 0, running: false, pending: [], roundCount: 0 })).toContain('自动标过词')
    expect(aiNextHint({ ...base, batchCount: 0, running: false, pending: [], roundCount: 0, autoVocabDone: false })).toBe('本篇待办已全部完成 🎉')
  })

  it('待办提示里的词去重、最多列 6 个并加省略号', () => {
    const pending = [job('a1', 'lookup', ['a', 'b', 'c', 'd']), job('a2', 'lookup', ['a', 'e', 'f', 'g', 'h'])]
    const text = aiNextHint({
      batchCount: 0,
      running: false,
      round: 0,
      phase: '',
      done: 0,
      total: 0,
      pending,
      roundCount: 2,
      autoVocabDone: false,
      batchName: '一键跑批',
    })
    expect(text).toContain('（a、b、c、d、e、f…）')
    expect(text).not.toContain('、g')
  })
})
