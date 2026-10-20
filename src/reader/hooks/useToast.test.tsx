// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { useToast } from './useToast'

describe('useToast：提示条', () => {
  afterEach(() => vi.useRealTimers())

  it('显示后到时自动清空', () => {
    vi.useFakeTimers()
    const { result } = renderHook(() => useToast(1000))
    act(() => result.current.flash('已保存'))
    expect(result.current.toast).toBe('已保存')
    act(() => vi.advanceTimersByTime(1000))
    expect(result.current.toast).toBe('')
  })

  it('连续 flash：旧定时器不会提前清掉新消息', () => {
    vi.useFakeTimers()
    const { result } = renderHook(() => useToast(1000))
    act(() => result.current.flash('第一条'))
    act(() => vi.advanceTimersByTime(800))
    act(() => result.current.flash('第二条'))
    act(() => vi.advanceTimersByTime(300)) // 若旧 timer 没清，这里会被清空
    expect(result.current.toast).toBe('第二条')
    act(() => vi.advanceTimersByTime(800))
    expect(result.current.toast).toBe('')
  })

  it('卸载时清掉定时器', () => {
    vi.useFakeTimers()
    const { result, unmount } = renderHook(() => useToast(1000))
    act(() => result.current.flash('走之前'))
    unmount()
    expect(vi.getTimerCount()).toBe(0)
  })
})
