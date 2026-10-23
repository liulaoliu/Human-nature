// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { useReaderPanels } from './useReaderPanels'

/**
 * 面板开关只有两条约定：**默认全关**（打开阅读页不该有浮层盖着正文）、
 * **互不干扰**（今日计划和生词本视图可以并存，关一个不能顺手关掉别的）。
 */
describe('useReaderPanels', () => {
  it('默认全是关着的，学习日志默认停在今天', () => {
    const { result } = renderHook(() => useReaderPanels())
    expect(result.current.speedReadOpen).toBe(false)
    expect(result.current.planOpen).toBe(false)
    expect(result.current.intensiveOpen).toBe(false)
    expect(result.current.journalOpen).toBe(false)
    expect(result.current.exportOpen).toBe(false)
    expect(result.current.goalOpen).toBe(false)
    expect(result.current.statsOpen).toBe(false)
    expect(result.current.browseAll).toBe(false)
    expect(result.current.journalDay).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })

  it('各开各的：开一个不影响别的', () => {
    const { result } = renderHook(() => useReaderPanels())
    act(() => result.current.setPlanOpen(true))
    act(() => result.current.setBrowseAll(true))
    expect(result.current.planOpen).toBe(true)
    expect(result.current.browseAll).toBe(true)
    expect(result.current.journalOpen).toBe(false)

    // 关一个也不连带关别的（这一步就是「状态散落」时最容易写错的地方）
    act(() => result.current.setPlanOpen(false))
    expect(result.current.browseAll).toBe(true)
  })

  it('学习日志可以直接跳到某一天', () => {
    const { result } = renderHook(() => useReaderPanels())
    act(() => result.current.setJournalDay('2026-10-01'))
    expect(result.current.journalDay).toBe('2026-10-01')
  })
})
