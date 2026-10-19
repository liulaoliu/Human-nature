// @vitest-environment jsdom
import { renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { registerHotkeys, resetHotkeysForTest } from './hotkeys'
import { useHotkeys } from './useHotkeys'

afterEach(() => resetHotkeysForTest())

const press = (key = 'a') => window.dispatchEvent(new KeyboardEvent('keydown', { key }))

describe('集中键盘分发', () => {
  it('只有最高优先级的处理器收到事件', () => {
    const low = vi.fn()
    const high = vi.fn()
    registerHotkeys(10, low)
    registerHotkeys(60, high)
    press()
    expect(high).toHaveBeenCalledTimes(1)
    expect(low).not.toHaveBeenCalled()
  })

  it('同优先级都会收到（ReaderApp 的 Ctrl 跟踪 + 正文快捷键）', () => {
    const a = vi.fn()
    const b = vi.fn()
    registerHotkeys(10, a)
    registerHotkeys(10, b)
    press()
    expect(a).toHaveBeenCalledTimes(1)
    expect(b).toHaveBeenCalledTimes(1)
  })

  it('注销后让位给低优先级；全部注销后不再崩', () => {
    const low = vi.fn()
    const high = vi.fn()
    registerHotkeys(10, low)
    const off = registerHotkeys(60, high)
    off()
    press()
    expect(high).not.toHaveBeenCalled()
    expect(low).toHaveBeenCalledTimes(1)
    resetHotkeysForTest()
    expect(() => press()).not.toThrow()
  })

  it('useHotkeys：enabled=false 不响应，打开后响应', () => {
    const fn = vi.fn()
    const { rerender } = renderHook(({ on }) => useHotkeys(fn, on, 30), { initialProps: { on: false } })
    press()
    expect(fn).not.toHaveBeenCalled()
    rerender({ on: true })
    press()
    expect(fn).toHaveBeenCalledTimes(1)
  })
})
