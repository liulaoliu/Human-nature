// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { vocabItem } from '../../core/testFixtures'
import { useStudyTimers, type UseStudyTimersOptions } from './useStudyTimers'

/** 两只表：单卡计时（换卡归零）与本轮总时长（每 15s / 退出补落盘）。 */
const queue = [vocabItem({ id: 'w1' }), vocabItem({ id: 'w2' })]

function options(over: Partial<UseStudyTimersOptions> = {}): UseStudyTimersOptions {
  return { queue, index: 0, addStudyTime: vi.fn(), ...over }
}

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('useStudyTimers：计时与落盘', () => {
  it('每秒累计本轮/单卡时长；换卡时单卡归零', () => {
    vi.useFakeTimers()
    const opts = options()
    const { result, rerender } = renderHook((p: UseStudyTimersOptions) => useStudyTimers(p), {
      initialProps: opts,
    })
    act(() => {
      vi.advanceTimersByTime(3000)
    })
    expect(result.current.liveSeconds).toBe(3)
    expect(result.current.cardSeconds).toBe(3)

    rerender({ ...opts, index: 1 })
    expect(result.current.cardSeconds).toBe(0)
    act(() => {
      vi.advanceTimersByTime(1000)
    })
    expect(result.current.cardSeconds).toBe(1)
    expect(result.current.liveSeconds).toBe(4)
  })

  it('每 15 秒落盘一次，退出时补记余数', () => {
    vi.useFakeTimers()
    const addStudyTime = vi.fn()
    const { unmount } = renderHook(() => useStudyTimers(options({ addStudyTime })))
    act(() => {
      vi.advanceTimersByTime(20000)
    })
    expect(addStudyTime).toHaveBeenCalledTimes(1)
    expect(addStudyTime).toHaveBeenCalledWith(15, 0)

    unmount()
    expect(addStudyTime).toHaveBeenCalledTimes(2)
    expect(addStudyTime).toHaveBeenLastCalledWith(5, 0)
  })

  it('没有队列（不在背单词）时不计时', () => {
    vi.useFakeTimers()
    const addStudyTime = vi.fn()
    const { result, unmount } = renderHook(() => useStudyTimers(options({ queue: null, addStudyTime })))
    act(() => {
      vi.advanceTimersByTime(5000)
    })
    expect(result.current.liveSeconds).toBe(0)
    expect(result.current.cardSeconds).toBe(0)
    unmount()
    expect(addStudyTime).not.toHaveBeenCalled()
  })

  it('暂停时两只表都停，恢复后接着走、不归零', () => {
    vi.useFakeTimers()
    const opts = options()
    const { result, rerender } = renderHook((p: UseStudyTimersOptions) => useStudyTimers(p), {
      initialProps: opts,
    })
    act(() => {
      vi.advanceTimersByTime(3000)
    })
    expect(result.current.cardSeconds).toBe(3)

    rerender({ ...opts, paused: true })
    act(() => {
      vi.advanceTimersByTime(10000)
    })
    expect(result.current.cardSeconds).toBe(3)
    expect(result.current.liveSeconds).toBe(3)

    rerender({ ...opts, paused: false })
    act(() => {
      vi.advanceTimersByTime(2000)
    })
    expect(result.current.cardSeconds).toBe(5)
    expect(result.current.liveSeconds).toBe(5)
  })

  it('暂停时把未落盘的秒数补记（编辑的时间不计入学习时长）', () => {
    vi.useFakeTimers()
    const addStudyTime = vi.fn()
    const opts = options({ addStudyTime })
    const { rerender, unmount } = renderHook((p: UseStudyTimersOptions) => useStudyTimers(p), {
      initialProps: opts,
    })
    act(() => {
      vi.advanceTimersByTime(20000)
    })
    expect(addStudyTime).toHaveBeenCalledTimes(1)
    expect(addStudyTime).toHaveBeenCalledWith(15, 0)

    rerender({ ...opts, paused: true })
    expect(addStudyTime).toHaveBeenCalledTimes(2)
    expect(addStudyTime).toHaveBeenLastCalledWith(5, 0)

    act(() => {
      vi.advanceTimersByTime(30000) // 暂停期间不记时长
    })
    rerender({ ...opts, paused: false })
    act(() => {
      vi.advanceTimersByTime(2000)
    })
    unmount()
    expect(addStudyTime).toHaveBeenCalledTimes(3)
    expect(addStudyTime).toHaveBeenLastCalledWith(2, 0)
  })
})
