// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { useReadDone } from './useReadDone'
import { installFakeStorage } from '../testStorage'

/**
 * 本机存储：jsdom 里取不到 / Node 26 自带只读全局，统一换成假 storage（见 testStorage.ts）。
 * 这样「刷新后还在」这条才测得住。
 */
let restoreStorage: () => void = () => {}
beforeEach(() => {
  restoreStorage = installFakeStorage()
})
afterEach(() => restoreStorage())

/**
 * 「读完一篇」的接线（localStorage + 派生值 + 动作）。
 * 规则在 core/goals 里已单测；这里测的是**接线**：真的落到本机存储、真的按天算、真的给提示。
 */

const baseProps = {
  articleIdentity: 'A 篇',
  articleTitle: 'A 篇',
  articleKey: 'A',
  todayKey: '2026-10-15',
}

describe('useReadDone', () => {
  it('标记读完：进今日列表、算出「第一次读完是哪天」、写进 readDays', () => {
    const flash = vi.fn()
    const { result } = renderHook(() => useReadDone({ ...baseProps, flash }))

    expect(result.current.todayReadDone).toEqual([])
    act(() => result.current.markReadDone())
    expect(result.current.todayReadDone.map((d) => d.articleId)).toEqual(['A 篇'])
    expect(result.current.articleReadDay).toBe('2026-10-15')
    expect(result.current.readDays).toEqual({ 'A 篇': '2026-10-15' })
    expect(flash).not.toHaveBeenCalled()
  })

  it('同一篇换一天重读：不重复计入，只提示一句', () => {
    const flash = vi.fn()
    const props = { ...baseProps, flash }
    const { result, rerender } = renderHook((p) => useReadDone(p), { initialProps: props })
    act(() => result.current.markReadDone())
    // 第二天（逻辑日变了）
    rerender({ ...props, todayKey: '2026-10-16' })
    act(() => result.current.markReadDone())
    expect(result.current.todayReadDone).toEqual([]) // 今天没记
    expect(result.current.articleReadDay).toBe('2026-10-15') // 还是第一次那天
    expect(flash).toHaveBeenCalledTimes(1)
    expect(flash.mock.calls[0][0]).toContain('2026-10-15')
  })

  it('撤销：记录删掉，标记也回到 null', () => {
    const flash = vi.fn()
    const { result } = renderHook(() => useReadDone({ ...baseProps, flash }))
    act(() => result.current.markReadDone())
    act(() => result.current.undoReadDone('A 篇'))
    expect(result.current.readDone).toEqual([])
    expect(result.current.articleReadDay).toBeNull()
  })

  it('没有当前文章：标记是空操作（不写脏记录）', () => {
    const flash = vi.fn()
    const { result } = renderHook(() => useReadDone({ ...baseProps, articleIdentity: null, flash }))
    act(() => result.current.markReadDone())
    expect(result.current.readDone).toEqual([])
  })

  it('落本机存储：重挂载还在（刷新不丢）', () => {
    const flash = vi.fn()
    const first = renderHook(() => useReadDone({ ...baseProps, flash }))
    act(() => first.result.current.markReadDone())
    first.unmount()
    const second = renderHook(() => useReadDone({ ...baseProps, flash }))
    expect(second.result.current.articleReadDay).toBe('2026-10-15')
  })
})
