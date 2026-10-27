// @vitest-environment jsdom
import { renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { hasModifier, isComposing, isEditableTarget, registerHotkeys, resetHotkeysForTest } from './hotkeys'
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

  it('公共判定：输入框 / 修饰键 / 输入法组合', () => {
    const input = document.createElement('input')
    const area = document.createElement('textarea')
    const div = document.createElement('div')
    expect(isEditableTarget(input)).toBe(true)
    expect(isEditableTarget(area)).toBe(true)
    expect(isEditableTarget(div)).toBe(false)
    expect(hasModifier({ ctrlKey: false, metaKey: false, altKey: false })).toBe(false)
    expect(hasModifier({ ctrlKey: true, metaKey: false, altKey: false })).toBe(true)
    expect(isComposing({ isComposing: true })).toBe(true)
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
