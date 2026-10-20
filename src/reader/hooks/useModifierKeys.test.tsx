// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { useModifierKeys } from './useModifierKeys'

const down = (key: string) => act(() => window.dispatchEvent(new KeyboardEvent('keydown', { key })))
const up = (key: string) => act(() => window.dispatchEvent(new KeyboardEvent('keyup', { key })))
const blur = () => act(() => window.dispatchEvent(new Event('blur')))

describe('useModifierKeys（Ctrl / ⌘ / Alt 按住状态）', () => {
  it('初始都没按住', () => {
    const { result } = renderHook(() => useModifierKeys())
    expect(result.current.ctrlHeld).toBe(false)
    expect(result.current.altHeld).toBe(false)
  })

  it('按下 Ctrl / Meta 都算 ctrlHeld，松开就清', () => {
    const { result } = renderHook(() => useModifierKeys())
    down('Control')
    expect(result.current.ctrlHeld).toBe(true)
    up('Control')
    expect(result.current.ctrlHeld).toBe(false)

    down('Meta')
    expect(result.current.ctrlHeld).toBe(true)
    up('Meta')
    expect(result.current.ctrlHeld).toBe(false)
  })

  it('Alt 单独跟踪，互不影响', () => {
    const { result } = renderHook(() => useModifierKeys())
    down('Alt')
    expect(result.current.altHeld).toBe(true)
    expect(result.current.ctrlHeld).toBe(false)
  })

  it('失焦时两个都清（切窗口收不到 keyup，不然会一直当按住）', () => {
    const { result } = renderHook(() => useModifierKeys())
    down('Control')
    down('Alt')
    expect(result.current.ctrlHeld && result.current.altHeld).toBe(true)
    blur()
    expect(result.current.ctrlHeld).toBe(false)
    expect(result.current.altHeld).toBe(false)
  })

  it('卸载后不再响应键盘', () => {
    const { result, unmount } = renderHook(() => useModifierKeys())
    unmount()
    down('Control')
    expect(result.current.ctrlHeld).toBe(false)
  })
})
