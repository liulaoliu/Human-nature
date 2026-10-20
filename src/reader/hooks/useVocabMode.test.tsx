// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { useVocabMode } from './useVocabMode'

function setup() {
  const setSessions = vi.fn()
  const hook = renderHook(() => useVocabMode({ setSessions }))
  return { ...hook, setSessions }
}

/** 模拟切走 / 切回标签页。 */
function setHidden(hidden: boolean) {
  Object.defineProperty(document, 'hidden', { value: hidden, configurable: true })
  document.dispatchEvent(new Event('visibilitychange'))
}

beforeEach(() => {
  vi.useFakeTimers()
  setHidden(false)
})

afterEach(() => {
  vi.useRealTimers()
  setHidden(false)
})

describe('useVocabMode：开关与计时', () => {
  it('打开：从 0 开始计时，本次选词数清零', () => {
    const { result } = setup()
    act(() => result.current.toggleVocabMode())
    expect(result.current.vocabMode).toBe(true)
    expect(result.current.vocabSeconds).toBe(0)
    expect(result.current.sessionPickedRef.current).toBe(0)

    act(() => {
      vi.advanceTimersByTime(2300)
    })
    expect(result.current.vocabSeconds).toBe(2)
  })

  it('关闭：按实际秒数 + 选词数记一条会话，并停止计时', () => {
    const { result, setSessions } = setup()
    act(() => result.current.toggleVocabMode())
    act(() => {
      vi.advanceTimersByTime(5000)
    })
    act(() => {
      result.current.sessionPickedRef.current = 3
    })
    act(() => result.current.toggleVocabMode())

    expect(result.current.vocabMode).toBe(false)
    expect(setSessions).toHaveBeenCalledOnce()
    const updater = setSessions.mock.calls[0][0] as (prev: unknown[]) => unknown[]
    const next = updater([])
    expect(next).toHaveLength(1)
    expect(next[0]).toMatchObject({ seconds: 5, picked: 3 })

    act(() => {
      vi.advanceTimersByTime(5000)
    })
    expect(result.current.vocabSeconds).toBe(5)
  })

  it('不足 1 秒且没选词：不记会话', () => {
    const { result, setSessions } = setup()
    act(() => result.current.toggleVocabMode())
    act(() => result.current.toggleVocabMode())
    expect(setSessions).not.toHaveBeenCalled()
  })

  it('会话最多留 500 条', () => {
    const { result, setSessions } = setup()
    act(() => result.current.toggleVocabMode())
    act(() => {
      vi.advanceTimersByTime(1000)
    })
    act(() => result.current.toggleVocabMode())
    const updater = setSessions.mock.calls[0][0] as (prev: unknown[]) => unknown[]
    const prev = Array.from({ length: 500 }, (_, i) => ({ at: `t${i}`, seconds: 1, picked: 0 }))
    const next = updater(prev)
    expect(next).toHaveLength(500)
    expect(next[499]).toMatchObject({ seconds: 1 })
  })
})

describe('useVocabMode：切走标签页暂停', () => {
  it('隐藏时停止累计，回来继续；从隐藏态开始时不计隐藏时间', () => {
    const { result } = setup()
    act(() => result.current.toggleVocabMode())
    act(() => {
      vi.advanceTimersByTime(2000)
    })
    act(() => setHidden(true))
    act(() => {
      vi.advanceTimersByTime(10_000)
    })
    expect(result.current.vocabSeconds).toBe(2)

    act(() => setHidden(false))
    act(() => {
      vi.advanceTimersByTime(3000)
    })
    expect(result.current.vocabSeconds).toBe(5)
  })

  it('卸载时清掉计时器', () => {
    const { result, unmount } = setup()
    act(() => result.current.toggleVocabMode())
    unmount()
    expect(vi.getTimerCount()).toBe(0)
  })
})
