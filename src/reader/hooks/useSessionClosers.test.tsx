// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { useSessionClosers } from './useSessionClosers'

describe('useSessionClosers：会话关闭注册表', () => {
  it('只关点名的会话，没注册的键静默跳过', () => {
    const { result } = renderHook(() => useSessionClosers())
    const study = vi.fn()
    const quiz = vi.fn()

    act(() => {
      result.current.closers.current.study = study
      result.current.closers.current.quiz = quiz
    })
    act(() => result.current.closeSessions('study', 'listen'))

    expect(study).toHaveBeenCalledTimes(1)
    expect(quiz).not.toHaveBeenCalled()
  })

  it('closeTransient 只关快刷与听写，学习组不受影响', () => {
    const { result } = renderHook(() => useSessionClosers())
    const call = vi.fn()

    act(() => {
      result.current.closers.current.quick = call
      result.current.closers.current.dictation = call
      result.current.closers.current.study = call
    })
    act(() => result.current.closeTransient())

    expect(call).toHaveBeenCalledTimes(2)
  })

  it('重复注册后者覆盖前者，旧动作不再被调用', () => {
    const { result } = renderHook(() => useSessionClosers())
    const first = vi.fn()
    const second = vi.fn()

    act(() => {
      result.current.closers.current.back = first
      result.current.closers.current.back = second
    })
    act(() => result.current.closeSessions('back'))

    expect(first).not.toHaveBeenCalled()
    expect(second).toHaveBeenCalledTimes(1)
  })

  it('closeSessions 身份稳定（子 hook 的 closeOthers 不会每次重建）', () => {
    const { result, rerender } = renderHook(() => useSessionClosers())
    const before = result.current.closeSessions
    rerender()
    expect(result.current.closeSessions).toBe(before)
  })
})
