// @vitest-environment jsdom
import { useState } from 'react'
import { act, renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { useGoldenImitation } from './useGoldenImitation'
import type { WritingRecord } from '../../core/writing'
import type { GoldenExamItem } from '../../types/document'

const item: GoldenExamItem = {
  id: 'exam:s1',
  sentenceId: 's1',
  task: '用 in response to 写一句关于环保的新句子。',
  model: 'In response to the pandemic, remote collaboration has become the new norm.',
  structure: 'In response to + n., … has become …',
  mustUse: ['in response to'],
  rubric: [{ dimension: '结构运用', weight: 100 }],
  source: 'local',
}

const feedback = {
  scores: [{ dimension: '结构运用', score: 90, max: 100 }],
  total: 90,
  max: 100,
  issues: [],
  polished: 'In response to the flood, remote work has become the new norm.',
  summary: '结构用对了。',
}

function setup(runAi = vi.fn(), aiStatus = vi.fn().mockResolvedValue(true)) {
  const recordActivity = vi.fn()
  const hook = renderHook(() => {
    const [history, setWritingHistory] = useState<WritingRecord[]>([])
    const imitation = useGoldenImitation({
      current: item,
      articleId: 'a1',
      articleTitle: 'A',
      source: 'goldenSentence',
      setWritingHistory,
      flash: vi.fn(),
      recordActivity,
      runAi,
      aiStatus,
      now: () => new Date('2026-10-28T00:00:00.000Z'),
    })
    return { imitation, history }
  })
  return { ...hook, recordActivity, runAi, aiStatus }
}

describe('useGoldenImitation', () => {
  it('单句仿写批改后写入历史，带 sentenceId 和来源', async () => {
    const raw = JSON.stringify(feedback)
    const runAi = vi.fn().mockResolvedValue({ results: [{ id: 'x', task: 'feedback', raw }], failed: [], dropped: 0 })
    const h = setup(runAi)
    act(() => h.result.current.imitation.setAnswer('In response to the flood, remote work has become the new norm.'))
    await act(async () => {
      await h.result.current.imitation.grade()
    })
    await waitFor(() => expect(h.result.current.imitation.feedback?.total).toBe(90))
    expect(h.result.current.history).toHaveLength(1)
    expect(h.result.current.history[0].source).toBe('goldenSentence')
    expect(h.result.current.history[0].sentenceId).toBe('s1')
    expect(h.result.current.history[0].model).toBe(item.model)
    expect(h.recordActivity).toHaveBeenCalledWith('write', 1)
  })

  it('按批改意见再写一稿：第二次批改记成第 2 稿，且只能改一次', async () => {
    const raw = JSON.stringify(feedback)
    const runAi = vi.fn().mockResolvedValue({ results: [{ id: 'x', task: 'feedback', raw }], failed: [], dropped: 0 })
    const h = setup(runAi)
    act(() => h.result.current.imitation.setAnswer('In response to the flood, remote work has become the new norm.'))
    await act(async () => {
      await h.result.current.imitation.grade()
    })
    await waitFor(() => expect(h.result.current.imitation.feedback).not.toBeNull())
    expect(h.result.current.imitation.canRewrite).toBe(true)

    act(() => h.result.current.imitation.rewrite())
    expect(h.result.current.imitation.round).toBe(2)
    expect(h.result.current.imitation.canRewrite).toBe(false)
    // 作答保留，用户照着意见改
    expect(h.result.current.imitation.answer).toContain('In response')

    await act(async () => {
      await h.result.current.imitation.grade()
    })
    await waitFor(() => expect(h.result.current.history).toHaveLength(2))
    expect(h.result.current.history[0].task?.round).toBe(2)
    expect(h.result.current.history[1].task?.round).toBeUndefined()

    // 已经第 2 稿：不再允许继续改
    act(() => h.result.current.imitation.rewrite())
    expect(h.result.current.imitation.round).toBe(2)
  })

  it('坏批改 JSON 只报错，不写历史', () => {
    const h = setup()
    act(() => h.result.current.imitation.setAnswer('In response to the flood, remote work has become the new norm.'))
    let ok = true
    act(() => {
      ok = h.result.current.imitation.applyGrade('not json')
    })
    expect(ok).toBe(false)
    expect(h.result.current.imitation.error).toContain('没解析出批改结果')
    expect(h.result.current.history).toHaveLength(0)
  })
})
