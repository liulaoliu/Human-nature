// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { learningRepo } from '../../adapters/learningRepo'
import {
  hasPendingLearningChanges,
  resetLearningSyncStateForTest,
} from '../learningState'
import { useLearningSync } from './useLearningSync'

afterEach(() => {
  localStorage.clear()
  resetLearningSyncStateForTest()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('useLearningSync', () => {
  it('学习记录变更标记 dirty，防抖写回成功后清掉', async () => {
    vi.useFakeTimers()
    const save = vi.spyOn(learningRepo, 'save').mockResolvedValue()
    localStorage.setItem(
      'reader:practice',
      JSON.stringify([{ at: '2026-05-01T00:00:00.000Z', kind: 'quiz', total: 5, correct: 5 }]),
    )
    const { unmount } = renderHook(() => useLearningSync())

    act(() => {
      window.dispatchEvent(new CustomEvent('reader:local-state', { detail: { key: 'reader:practice' } }))
    })
    expect(hasPendingLearningChanges()).toBe(true)

    await act(async () => {
      await vi.advanceTimersByTimeAsync(800)
    })

    expect(save).toHaveBeenCalledWith(
      expect.objectContaining({
        practice: [expect.objectContaining({ kind: 'quiz', correct: 5 })],
      }),
    )
    expect(hasPendingLearningChanges()).toBe(false)
    unmount()
  })

  it('增量写库失败后保留 dirty，并按退避整份重试', async () => {
    vi.useFakeTimers()
    localStorage.setItem(
      'reader:practice',
      JSON.stringify([{ at: '2026-05-01T00:00:00.000Z', kind: 'quiz', total: 5, correct: 5 }]),
    )
    const save = vi.spyOn(learningRepo, 'save').mockResolvedValue()
    const savePartial = vi.spyOn(learningRepo, 'savePartial').mockRejectedValue(new Error('offline'))
    const { unmount } = renderHook(() => useLearningSync())

    // 挂载后的首次整份同步。
    await act(async () => {
      await vi.advanceTimersByTimeAsync(800)
    })
    expect(save).toHaveBeenCalledTimes(1)
    expect(hasPendingLearningChanges()).toBe(false)

    act(() => {
      window.dispatchEvent(new CustomEvent('reader:local-state', { detail: { key: 'reader:practice' } }))
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(800)
    })
    expect(savePartial).toHaveBeenCalledTimes(1)
    expect(hasPendingLearningChanges()).toBe(true)

    // 5 秒后重试；失败过的 section 不能因为 pending 已清空就永远不写了。
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000)
    })
    expect(save).toHaveBeenCalledTimes(2)
    expect(hasPendingLearningChanges()).toBe(false)
    unmount()
  })

  it('启动时整份同步失败也会退避重试', async () => {
    vi.useFakeTimers()
    localStorage.setItem(
      'reader:practice',
      JSON.stringify([{ at: '2026-05-01T00:00:00.000Z', kind: 'quiz', total: 5, correct: 5 }]),
    )
    const save = vi.spyOn(learningRepo, 'save').mockRejectedValueOnce(new Error('offline')).mockResolvedValue()
    const { unmount } = renderHook(() => useLearningSync())

    await act(async () => {
      await vi.advanceTimersByTimeAsync(800)
    })
    expect(save).toHaveBeenCalledTimes(1)

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000)
    })
    expect(save).toHaveBeenCalledTimes(2)
    unmount()
  })

  it('偏好键不触发学习记录写库', async () => {
    vi.useFakeTimers()
    const save = vi.spyOn(learningRepo, 'save').mockResolvedValue()
    const { unmount } = renderHook(() => useLearningSync())

    act(() => {
      window.dispatchEvent(new CustomEvent('reader:local-state', { detail: { key: 'reader:theme' } }))
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(800)
    })

    expect(save).not.toHaveBeenCalled()
    unmount()
  })
})
