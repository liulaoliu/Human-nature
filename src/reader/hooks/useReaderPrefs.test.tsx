// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { useReaderPrefs } from './useReaderPrefs'
import { dayKeyLocal } from '../../core/activity'

beforeEach(() => localStorage.clear())

describe('useReaderPrefs（阅读页本机偏好）', () => {
  it('没存过时给默认值', () => {
    const { result } = renderHook(() => useReaderPrefs())
    expect(result.current.fontSize).toBe('md')
    expect(result.current.bold).toBe(false)
    expect(result.current.serif).toBe(false)
    expect(result.current.eye).toBe(false)
    expect(result.current.toolbarWidth).toBe('auto')
    expect(result.current.sideTab).toBe('overview')
    expect(result.current.translateView).toBe('off')
    expect(result.current.autoSpeak).toBe(false)
    expect(result.current.vocabLevel).toBe('cet6')
    expect(result.current.vocabView).toBe('card')
    expect(result.current.vocabSort).toBe('updatedAt')
    expect(result.current.dailyGoal).toBe(20)
    expect(result.current.showLanguage).toBe(false)
    expect(result.current.confusableBatchSize).toBe(60)
    expect(result.current.aiPackScope).toBe('article')
    expect(result.current.autoVocabDirect).toBe(true)
    expect(result.current.newLimit).toBe(20)
    expect(result.current.newToday).toBe(0)
  })

  it('改一项会写回原来的键（刷新后还在）', () => {
    const { result } = renderHook(() => useReaderPrefs())
    act(() => result.current.setSideTab('stats'))
    expect(result.current.sideTab).toBe('stats')
    expect(localStorage.getItem('reader:sideTab')).toBe('stats')

    act(() => result.current.setBold(true))
    expect(localStorage.getItem('reader:bold')).toBe('1')

    act(() => result.current.setEye(true))
    expect(localStorage.getItem('reader:theme')).toBe('green')

    act(() => result.current.setDailyGoal(50))
    expect(localStorage.getItem('reader:dailyGoal')).toBe('50')
  })

  it('存过的值读得回来', () => {
    localStorage.setItem('reader:size', 'lg')
    localStorage.setItem('reader:theme', 'green')
    localStorage.setItem('reader:sideTab', 'vocab')
    const { result } = renderHook(() => useReaderPrefs())
    expect(result.current.fontSize).toBe('lg')
    expect(result.current.eye).toBe(true)
    expect(result.current.sideTab).toBe('vocab')
  })

  it('脏值回默认（枚举越界 / 布尔乱填）', () => {
    localStorage.setItem('reader:sideTab', 'nope')
    localStorage.setItem('reader:translateView', 'sideways')
    const { result } = renderHook(() => useReaderPrefs())
    expect(result.current.sideTab).toBe('overview')
    expect(result.current.translateView).toBe('off')
  })

  it('顶栏宽度档位：默认自适应，改了写进本机，脏值回到自适应', () => {
    const { result } = renderHook(() => useReaderPrefs())
    expect(localStorage.getItem('reader:toolbarWidth')).toBeNull()

    act(() => result.current.setToolbarWidth('wide'))
    expect(result.current.toolbarWidth).toBe('wide')
    expect(localStorage.getItem('reader:toolbarWidth')).toBe('wide')

    // 手改 / 旧版本留下的怪值：不许把顶栏撑坏，回自适应
    localStorage.setItem('reader:toolbarWidth', 'enormous')
    const dirty = renderHook(() => useReaderPrefs())
    expect(dirty.result.current.toolbarWidth).toBe('auto')
  })

  it('newToday 落盘带当天日期，跨天读回来归零', () => {
    const { result } = renderHook(() => useReaderPrefs())
    act(() => result.current.setNewToday(3))
    expect(JSON.parse(localStorage.getItem('reader:newToday') ?? '{}')).toEqual({
      day: dayKeyLocal(),
      count: 3,
    })
    expect(result.current.newToday).toBe(3)

    // 换一台机器/隔天：存的是旧日期
    localStorage.setItem('reader:newToday', JSON.stringify({ day: '2000-01-01', count: 9 }))
    const again = renderHook(() => useReaderPrefs())
    expect(again.result.current.newToday).toBe(0)
  })
})
