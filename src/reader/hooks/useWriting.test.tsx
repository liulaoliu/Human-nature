// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'
import { installFakeStorage } from '../testStorage'
import { useWriting, type UseWritingParams } from './useWriting'

const DRAFT_KEY = 'reader:writingDraft'

const doc = {
  sentences: [
    { id: 's1', text: 'Run fast.', language: { structure: 'SV', phrases: ['run fast'] } },
    { id: 's2', text: 'Walk slow.' },
  ],
}

function params(over: Partial<UseWritingParams> = {}): UseWritingParams {
  return {
    doc,
    selectedId: 's2',
    flash: vi.fn(),
    setLastTask: vi.fn(),
    askedWordsRef: { current: ['old'] },
    askedIdsRef: { current: ['old'] },
    closeOthers: vi.fn(),
    ...over,
  }
}

let restore: () => void = () => {}

beforeEach(() => {
  restore = installFakeStorage()
  Object.assign(navigator, { clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } })
})

afterEach(() => {
  restore()
  vi.restoreAllMocks()
})

describe('useWriting：草稿恢复（外部数据守卫）', () => {
  it('坏 JSON → 空草稿，不影响打开', () => {
    localStorage.setItem(DRAFT_KEY, '{bad')
    const { result } = renderHook(() => useWriting(params()))
    expect(result.current.model).toBe('')
    expect(result.current.text).toBe('')
    expect(result.current.task).toBeNull()
  })

  it('task 形状不合格 → 丢弃 task，保留文本', () => {
    localStorage.setItem(DRAFT_KEY, JSON.stringify({ model: 'M', text: 'T', task: { nope: 1 } }))
    const { result } = renderHook(() => useWriting(params()))
    expect(result.current.model).toBe('M')
    expect(result.current.text).toBe('T')
    expect(result.current.task).toBeNull()
  })

  it('合法草稿原样恢复', () => {
    const task = { task: '仿写一句', model: 'Run fast.', rubric: [] }
    localStorage.setItem(DRAFT_KEY, JSON.stringify({ model: 'Run fast.', text: 'I run.', task }))
    const { result } = renderHook(() => useWriting(params()))
    expect(result.current.model).toBe('Run fast.')
    expect(result.current.text).toBe('I run.')
    expect(result.current.task?.task).toBe('仿写一句')
  })

  it('改草稿会写回 localStorage', async () => {
    const { result } = renderHook(() => useWriting(params()))
    act(() => result.current.setText('new text'))
    await waitFor(() => expect(JSON.parse(localStorage.getItem(DRAFT_KEY) ?? '{}').text).toBe('new text'))
  })
})

describe('useWriting：开始与复制提示词', () => {
  it('没文章 → 只提示，不开面板', () => {
    const p = params({ doc: null })
    const { result } = renderHook(() => useWriting(p))
    act(() => result.current.start())
    expect(p.flash).toHaveBeenCalledWith('先打开一篇文章')
    expect(result.current.open).toBe(false)
    expect(p.closeOthers).not.toHaveBeenCalled()
  })

  it('开始：范句优先当前选中句，清空作答/反馈', () => {
    const p = params()
    const { result } = renderHook(() => useWriting(p))
    act(() => result.current.start())
    expect(p.closeOthers).toHaveBeenCalled()
    expect(result.current.open).toBe(true)
    expect(result.current.model).toBe('Walk slow.')
    expect(result.current.text).toBe('')
    expect(result.current.feedback).toBeNull()
  })

  it('复制仿写任务：空范句只提示；成功时清空提问上下文', async () => {
    const p = params()
    const { result } = renderHook(() => useWriting(p))
    await act(async () => result.current.copyImitationTask())
    expect(p.flash).toHaveBeenCalledWith('先选一句范句')

    act(() => result.current.setModel('Run fast.'))
    await act(async () => result.current.copyImitationTask())
    expect(navigator.clipboard.writeText).toHaveBeenCalled()
    expect(p.setLastTask).toHaveBeenCalledWith('imitation')
    expect(p.askedWordsRef.current).toEqual([])
    expect(p.askedIdsRef.current).toEqual([])
  })

  it('复制批改：没任务 / 没作答分别提示；成功时发 feedback', async () => {
    const p = params()
    const { result } = renderHook(() => useWriting(p))
    await act(async () => result.current.copyFeedback())
    expect(p.flash).toHaveBeenCalledWith('先生成仿写任务')

    act(() => result.current.setTask({ task: '仿写', model: 'Run fast.', rubric: [], mustUse: [] }))
    await act(async () => result.current.copyFeedback())
    expect(p.flash).toHaveBeenCalledWith('先写点东西再批改')

    act(() => result.current.setText('I ran fast.'))
    await act(async () => result.current.copyFeedback())
    expect(p.setLastTask).toHaveBeenCalledWith('feedback')
  })

  it('loadRecord 回填历史记录', () => {
    const { result } = renderHook(() => useWriting(params()))
    act(() =>
      result.current.loadRecord({
        at: '2026-10-20T00:00:00.000Z',
        model: 'M',
        text: 'T',
        feedback: { score: 8, comments: [], rewritten: '' },
        task: { task: 'T', model: 'M', rubric: [] },
      } as never),
    )
    expect(result.current.model).toBe('M')
    expect(result.current.text).toBe('T')
    expect(result.current.task?.task).toBe('T')
  })
})
