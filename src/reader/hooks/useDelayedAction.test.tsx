// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { useDelayedAction } from './useDelayedAction'

describe('useDelayedAction', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('到点执行；重复调度会覆盖上一个', () => {
    const fn = vi.fn()
    const { result } = renderHook(() => useDelayedAction())
    act(() => {
      result.current.schedule(100, () => fn('first'))
      result.current.schedule(200, () => fn('second'))
    })
    act(() => vi.advanceTimersByTime(100))
    expect(fn).not.toHaveBeenCalled()
    act(() => vi.advanceTimersByTime(100))
    expect(fn).toHaveBeenCalledTimes(1)
    expect(fn).toHaveBeenCalledWith('second')
  })

  it('clear 取消待执行动作', () => {
    const fn = vi.fn()
    const { result } = renderHook(() => useDelayedAction())
    act(() => result.current.schedule(100, fn))
    act(() => result.current.clear())
    act(() => vi.advanceTimersByTime(100))
    expect(fn).not.toHaveBeenCalled()
  })

  it('卸载时清掉定时器，不在卸载后回写', () => {
    const fn = vi.fn()
    const { result, unmount } = renderHook(() => useDelayedAction())
    act(() => result.current.schedule(100, fn))
    unmount()
    act(() => vi.advanceTimersByTime(100))
    expect(fn).not.toHaveBeenCalled()
  })
})
