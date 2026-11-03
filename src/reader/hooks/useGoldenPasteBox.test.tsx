// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { useGoldenPasteBox } from './useGoldenPasteBox'

describe('useGoldenPasteBox', () => {
  it('手动复制先展开；自动链路只在 copied 时展开', async () => {
    const h = renderHook(() => useGoldenPasteBox())
    const copy = vi.fn()

    act(() => h.result.current.copy(copy))
    expect(copy).toHaveBeenCalledTimes(1)
    expect(h.result.current.open).toBe(true)

    act(() => h.result.current.setOpen(false))
    await act(async () => {
      await h.result.current.auto(async () => 'graded')
    })
    expect(h.result.current.open).toBe(false)

    await act(async () => {
      await h.result.current.auto(async () => 'copied')
    })
    expect(h.result.current.open).toBe(true)
  })

  it('应用成功才清空并收起；失败保留输入和展开', () => {
    const h = renderHook(() => useGoldenPasteBox())
    act(() => h.result.current.setText('{"scores":[]}'))
    act(() => h.result.current.setOpen(true))

    let ok = true
    act(() => {
      ok = h.result.current.apply(() => false)
    })
    expect(ok).toBe(false)
    expect(h.result.current.open).toBe(true)
    expect(h.result.current.text).toBe('{"scores":[]}')

    act(() => {
      ok = h.result.current.apply((text) => text === '{"scores":[]}')
    })
    expect(ok).toBe(true)
    expect(h.result.current.open).toBe(false)
    expect(h.result.current.text).toBe('')
  })
})
