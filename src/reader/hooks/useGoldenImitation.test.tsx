// @vitest-environment jsdom
import { useState } from 'react'
import { act, renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { useGoldenImitation } from './useGoldenImitation'
import type { WritingRecord } from '../../core/writing'
import type { GoldenExamItem } from '../../types/document'
import { errorFixExamItem, type WritingErrorCard } from '../../core/writingErrorReview'

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

function setup(runAi = vi.fn(), aiStatus = vi.fn().mockResolvedValue(true), now = () => new Date('2026-10-28T00:00:00.000Z')) {
  const recordActivity = vi.fn()
  const hook = renderHook(() => {
    const [history, setWritingHistory] = useState<WritingRecord[]>([])
    const imitation = useGoldenImitation({
      current: item,
      articleId: 'a1',
      articleTitle: 'A',
      source: 'goldenSentence',
      setWritingHistory,
      writingHistory: history,
      flash: vi.fn(),
      recordActivity,
      runAi,
      aiStatus,
      now,
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

  it('同一题同一稿、文字没改，重复点批改不重复记', async () => {
    const raw = JSON.stringify(feedback)
    const runAi = vi.fn().mockResolvedValue({ results: [{ id: 'x', task: 'feedback', raw }], failed: [], dropped: 0 })
    const h = setup(runAi)
    act(() => h.result.current.imitation.setAnswer('In response to the flood, remote work has become the new norm.'))
    await act(async () => {
      await h.result.current.imitation.grade()
    })
    await waitFor(() => expect(h.result.current.history).toHaveLength(1))
    await act(async () => {
      await h.result.current.imitation.grade()
    })
    await waitFor(() => expect(h.result.current.imitation.feedback).not.toBeNull())
    expect(h.result.current.history).toHaveLength(1)
  })

  it('同一题多次批改可以翻页看：◀ 上一次 → 历史，▶ 下一次 → 回到最新', async () => {
    const raw = JSON.stringify(feedback)
    const runAi = vi.fn().mockResolvedValue({ results: [{ id: 'x', task: 'feedback', raw }], failed: [], dropped: 0 })
    // 每次批改往后走 1 分钟：历史按 at 排序，固定时钟会让两条同时刻
    let t = 0
    const h = setup(runAi, vi.fn().mockResolvedValue(true), () => new Date(Date.parse('2026-10-28T00:00:00.000Z') + t++ * 60_000))
    const write = async (text: string) => {
      act(() => h.result.current.imitation.setAnswer(text))
      await act(async () => {
        await h.result.current.imitation.grade()
      })
      await waitFor(() => expect(h.result.current.imitation.feedback).not.toBeNull())
    }
    await write('First try.')
    await write('Second try, improved.')
    await waitFor(() => expect(h.result.current.imitation.attempts).toHaveLength(2))
    expect(h.result.current.imitation.viewing).toBeNull()

    act(() => h.result.current.imitation.earlier())
    expect(h.result.current.imitation.viewing?.text).toBe('First try.')
    act(() => h.result.current.imitation.earlier())
    expect(h.result.current.imitation.viewing?.text).toBe('First try.')

    // ▶ 先走到最新那一条，再点一次才回到实时视图
    act(() => h.result.current.imitation.later())
    expect(h.result.current.imitation.viewing?.text).toBe('Second try, improved.')
    act(() => h.result.current.imitation.later())
    expect(h.result.current.imitation.viewing).toBeNull()
    act(() => h.result.current.imitation.backToLive())
    expect(h.result.current.imitation.viewing).toBeNull()
  })

  it('错因订正：外部答案覆盖 state，记录 source=goldenError 并带 focus', async () => {
    const card: WritingErrorCard = {
      id: 'errfix:word-spelling|spelling-bureaucracy',
      rule: 'word-spelling',
      type: 'spelling',
      key: 'spelling-bureaucracy',
      original: 'bureacracy',
      suggestion: 'bureaucracy',
      text: 'I learn bureacracy.',
      recordKey: 'r1',
      at: '2026-10-30T00:00:00.000Z',
      articleId: 'a1',
      sentenceId: 's1',
    }
    const raw = JSON.stringify(feedback)
    const runAi = vi.fn().mockResolvedValue({ results: [{ id: 'x', task: 'feedback', raw }], failed: [], dropped: 0 })
    const h = renderHook(() => {
      const [history, setWritingHistory] = useState<WritingRecord[]>([])
      const imitation = useGoldenImitation({
        current: errorFixExamItem(card),
        articleId: 'a1',
        articleTitle: 'A',
        source: 'goldenError',
        setWritingHistory,
        writingHistory: history,
        flash: vi.fn(),
        recordActivity: vi.fn(),
        runAi,
        aiStatus: vi.fn().mockResolvedValue(true),
      })
      return { imitation, history }
    })
    await act(async () => {
      await h.result.current.imitation.grade('bureaucracy')
    })
    await waitFor(() => expect(h.result.current.history).toHaveLength(1))
    expect(h.result.current.history[0]).toMatchObject({
      source: 'goldenError',
      sentenceId: 's1',
      text: 'bureaucracy',
    })
    expect(h.result.current.history[0].task?.focus).toContain('bureacracy')
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
