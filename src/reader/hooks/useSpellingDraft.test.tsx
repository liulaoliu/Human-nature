// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { useSpellingDraft } from './useSpellingDraft'

describe('useSpellingDraft：叶子组件里的拼写草稿', () => {
  it('按键只改本地草稿；换卡（resetKey 变）清空', () => {
    const { result, rerender } = renderHook(({ key }) => useSpellingDraft(key), {
      initialProps: { key: 'v1' },
    })
    act(() => result.current.change('run'))
    expect(result.current.draft).toBe('run')

    rerender({ key: 'v2' })
    expect(result.current.draft).toBe('')
  })

  it('published ref 同步当前值，clear 也清 ref', () => {
    const published = { current: '' }
    const { result } = renderHook(() => useSpellingDraft('v1', published))

    act(() => result.current.change('run'))
    expect(published.current).toBe('run')

    act(() => result.current.clear())
    expect(result.current.draft).toBe('')
    expect(published.current).toBe('')
  })

  it('resetKey 变化时把 published 也清掉（提交按钮不会读到上一张卡的草稿）', () => {
    const published = { current: '' }
    const { result, rerender } = renderHook(({ key }) => useSpellingDraft(key, published), {
      initialProps: { key: 'v1' },
    })
    act(() => result.current.change('run'))
    expect(published.current).toBe('run')

    rerender({ key: 'v2' })
    expect(published.current).toBe('')
  })
})
