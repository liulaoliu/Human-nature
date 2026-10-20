// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { clearScrollMemory, readScroll, saveScroll } from '../../state/scrollPrefs'
import { SCROLL_SAVE_DELAY_MS, useReadingScroll } from './useReadingScroll'

/**
 * 滚动进度持久化：恢复到位、滚动节流落盘、换篇结清、卸载结清。
 *
 * 这里用「假元素」而不是真 DOM：jsdom 不做布局，`scrollHeight` 恒为 0，
 * 恢复与节流都会被「可滚区间 0」的守卫挡掉，测不到真行为。
 */
function fakeEl(scrollHeight = 1000, clientHeight = 500) {
  const listeners = new Map<string, () => void>()
  const el = {
    scrollTop: 0,
    scrollHeight,
    clientHeight,
    addEventListener: (t: string, fn: () => void) => {
      listeners.set(t, fn)
    },
    removeEventListener: (t: string) => {
      listeners.delete(t)
    },
  }
  return {
    el,
    /** 触发一次 scroll（等价于用户滚了） */
    scrollTo(top: number) {
      el.scrollTop = top
      listeners.get('scroll')?.()
    },
    ref: { current: el as unknown as HTMLElement },
  }
}

beforeEach(() => {
  localStorage.clear()
  clearScrollMemory()
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('useReadingScroll：恢复', () => {
  it('没存过 → 停在顶部', () => {
    const { ref, el } = fakeEl()
    renderHook(() => useReadingScroll(ref, 'doc:1'))
    expect(el.scrollTop).toBe(0)
  })

  it('存过 50% → 恢复到可滚区间的一半', () => {
    saveScroll('doc:1', 0.5)
    const { ref, el } = fakeEl(1000, 500)
    renderHook(() => useReadingScroll(ref, 'doc:1'))
    expect(el.scrollTop).toBe(250)
  })

  it('内容还不够长（可滚区间 0）→ 不恢复，也不记', () => {
    saveScroll('doc:1', 0.5)
    const { ref, el, scrollTo } = fakeEl(400, 500)
    renderHook(() => useReadingScroll(ref, 'doc:1'))
    expect(el.scrollTop).toBe(0)

    scrollTo(0)
    act(() => {
      vi.advanceTimersByTime(SCROLL_SAVE_DELAY_MS)
    })
    // 原来那笔 0.5 没被「渲染中算顶部」冲掉
    expect(Math.round(readScroll('doc:1') * 100)).toBe(50)
  })
})

describe('useReadingScroll：落盘', () => {
  it('滚到 60% → 停止滚动 400ms 后写一次', () => {
    const { ref, scrollTo } = fakeEl()
    renderHook(() => useReadingScroll(ref, 'doc:1'))

    scrollTo(300)
    act(() => {
      vi.advanceTimersByTime(SCROLL_SAVE_DELAY_MS - 1)
    })
    expect(localStorage.getItem('reader:scroll:doc:1')).toBe(null)

    act(() => {
      vi.advanceTimersByTime(1)
    })
    expect(localStorage.getItem('reader:scroll:doc:1')).toBe('0.6')
  })

  it('滚动途中只写最后一笔（trailing 节流）', () => {
    const { ref, scrollTo } = fakeEl()
    renderHook(() => useReadingScroll(ref, 'doc:1'))

    scrollTo(100)
    scrollTo(200)
    scrollTo(400)
    act(() => {
      vi.advanceTimersByTime(SCROLL_SAVE_DELAY_MS)
    })
    expect(localStorage.getItem('reader:scroll:doc:1')).toBe('0.8')
  })

  it('滚回顶部也会记（否则下次打开还会跳回下面）', () => {
    saveScroll('doc:1', 0.7)
    const { ref, scrollTo } = fakeEl()
    renderHook(() => useReadingScroll(ref, 'doc:1'))
    expect('scrollTop' in ref.current!).toBe(true)

    scrollTo(0)
    act(() => {
      vi.advanceTimersByTime(SCROLL_SAVE_DELAY_MS)
    })
    expect(localStorage.getItem('reader:scroll:doc:1')).toBe('0')
  })

  it('刚滚完就卸载 → 还没到 400ms 也要写掉', () => {
    const { ref, scrollTo, el } = fakeEl()
    const { unmount } = renderHook(() => useReadingScroll(ref, 'doc:1'))

    scrollTo(250)
    expect(localStorage.getItem('reader:scroll:doc:1')).toBe(null)

    unmount()
    expect(el.scrollTop).toBe(250)
    expect(localStorage.getItem('reader:scroll:doc:1')).toBe('0.5')
  })
})

describe('useReadingScroll：换篇', () => {
  it('换文章：先把上一篇没落盘的那笔写掉，再恢复这篇自己的位置', () => {
    saveScroll('doc:2', 0.2)
    const { ref, scrollTo, el } = fakeEl()
    const { rerender } = renderHook(({ key }: { key: string }) => useReadingScroll(ref, key), {
      initialProps: { key: 'doc:1' },
    })

    scrollTo(300) // doc:1 读到 60%，还没到 400ms 就换篇
    rerender({ key: 'doc:2' })

    expect(localStorage.getItem('reader:scroll:doc:1')).toBe('0.6')
    expect(el.scrollTop).toBe(100) // doc:2 的 20%
  })

  it('两篇各自的进度互不覆盖', () => {
    const { ref, scrollTo, el } = fakeEl()
    const { rerender } = renderHook(({ key }: { key: string }) => useReadingScroll(ref, key), {
      initialProps: { key: 'doc:1' },
    })

    scrollTo(400) // doc:1 → 0.8
    rerender({ key: 'doc:2' })
    scrollTo(50) // doc:2 → 0.1
    rerender({ key: 'doc:1' })
    expect(el.scrollTop).toBe(400)

    rerender({ key: 'doc:2' })
    expect(el.scrollTop).toBe(50)
  })
})
