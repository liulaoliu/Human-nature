// @vitest-environment jsdom
import { useState } from 'react'
import { act, renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { ProductionPrompt } from '../../core/production'
import type { WritingRecord } from '../../core/writing'
import { useProductionAttempt, type UseProductionAttemptParams } from './useProductionAttempt'

const feedbackRaw = JSON.stringify({
  version: 2,
  scores: [{ dimension: '意思', score: 40, max: 40 }],
  total: 40,
  max: 40,
  issues: [],
  recommendations: [],
  polished: 'I will follow up this afternoon.',
  summary: '表达清楚。',
})

const prompt: ProductionPrompt = {
  id: 'p1',
  zh: '跟同事说明你下午会跟进。',
  goal: '说明进度',
  targets: [{ id: 'v1|self|word', itemId: 'v1', kind: 'word', text: 'run', meaning: '跑' }],
}

function setup(overrides: Partial<UseProductionAttemptParams> = {}) {
  let records: WritingRecord[] = []
  const callAi = vi.fn(async () => feedbackRaw)
  const ensureAi = vi.fn(async () => true)
  const copy = vi.fn(async () => true)
  const flash = vi.fn()
  const recordActivity = vi.fn()
  const onNext = vi.fn()
  const onDone = vi.fn()
  const hook = renderHook(() => {
    const [writingHistory, setWritingHistory] = useState<WritingRecord[]>([])
    records = writingHistory
    return useProductionAttempt({
      current: prompt,
      sessionTopic: '跟进进度',
      sessionMode: 'full',
      sessionId: 's1',
      articleIdentity: 'A',
      articleTitle: 'A',
      hasNext: true,
      onNext,
      onDone,
      setWritingHistory,
      recordActivity,
      ensureAi,
      callAi,
      copy,
      flash,
      now: () => new Date('2026-11-05T10:00:00.000Z'),
      ...overrides,
    })
  })
  return {
    ...hook,
    callAi,
    ensureAi,
    copy,
    flash,
    recordActivity,
    onNext,
    onDone,
    getRecords: () => records,
  }
}

describe('useProductionAttempt：一题作答状态机', () => {
  it('批改失败不清答案，也不落库', async () => {
    const h = setup({ callAi: vi.fn(async () => '这不是 JSON') })
    act(() => h.result.current.setAnswer('I run daily.'))
    await act(async () => {
      await h.result.current.grade()
    })
    expect(h.result.current.answer).toBe('I run daily.')
    expect(h.result.current.feedback).toBeNull()
    expect(h.result.current.error).toContain('没解析出批改结果')
    expect(h.getRecords()).toHaveLength(0)
    expect(h.result.current.grading).toBe(false)
  })

  it('粘回坏 JSON 不落库，也不清掉待粘回的提示词', async () => {
    const h = setup({ ensureAi: vi.fn(async () => false) })
    act(() => h.result.current.setAnswer('I run daily.'))
    await act(async () => {
      await h.result.current.grade()
    })
    expect(h.result.current.pasteKind).toBe('feedback')
    expect(h.result.current.pendingPrompt).not.toBe('')

    act(() => h.result.current.applyFeedbackPaste('{"version":2'))
    expect(h.result.current.error).toContain('没解析出批改结果')
    expect(h.getRecords()).toHaveLength(0)
    expect(h.result.current.pendingPrompt).not.toBe('')

    act(() => h.result.current.applyFeedbackPaste(feedbackRaw))
    expect(h.getRecords()).toHaveLength(1)
    expect(h.result.current.feedback?.total).toBe(40)
  })

  it('重写进入第二稿：清掉当前批改，把上一稿留给下一轮', async () => {
    const h = setup()
    act(() => h.result.current.setAnswer('I run daily.'))
    await act(async () => {
      await h.result.current.grade()
    })
    expect(h.result.current.round).toBe(1)
    expect(h.result.current.feedback).not.toBeNull()

    act(() => h.result.current.rewrite())
    expect(h.result.current.round).toBe(2)
    expect(h.result.current.feedback).toBeNull()
    expect(h.result.current.previousFeedback?.total).toBe(40)
    expect(h.result.current.hits).toEqual([])

    act(() => h.result.current.setAnswer('I run every day.'))
    await act(async () => {
      await h.result.current.grade()
    })
    expect(h.result.current.round).toBe(2)
    expect(h.getRecords()).toHaveLength(2)
  })

  it('跳过着保留一条 source=production 的记录，但不记学习活动', () => {
    const h = setup()
    act(() => h.result.current.setAnswer('draft answer'))
    act(() => h.result.current.skip())
    const records = h.getRecords()
    expect(records).toHaveLength(1)
    expect(records[0].source).toBe('production')
    expect(records[0].text).toBe('draft answer')
    expect((records[0].task as { skipped?: boolean }).skipped).toBe(true)
    expect(h.recordActivity).not.toHaveBeenCalled()
    expect(h.onNext).toHaveBeenCalledTimes(1)
    expect(h.onDone).not.toHaveBeenCalled()
  })
})
