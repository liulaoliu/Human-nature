// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { DEFAULT_ARTICLE_KINDS, DEFAULT_QUIZ_KINDS, useQuizSettings } from './useQuizSettings'
import { installFakeStorage } from '../testStorage'

/**
 * 设置持久化：默认值、坏数据回默认、写入能落盘。
 * 「候选池 / 出题」的规则在 core/quizPool 有单测，这里只测存取。
 */
let restore: () => void = () => {}

beforeEach(() => {
  restore = installFakeStorage()
  localStorage.clear()
})

afterEach(() => {
  restore()
})

describe('useQuizSettings：默认值', () => {
  it('没存过 → 用默认题型 / 范围 / 题量', () => {
    const { result } = renderHook(() => useQuizSettings())
    expect(result.current.kinds).toEqual(DEFAULT_QUIZ_KINDS)
    expect(result.current.articleKinds).toEqual(DEFAULT_ARTICLE_KINDS)
    expect(result.current.scope).toBe('article')
    expect(result.current.limit).toBe(20)
    expect(result.current.unique).toBe(true)
    expect(result.current.speakAfter).toBe(true)
    expect(result.current.auto).toBe(false)
    expect(result.current.loopWrong).toBe(false)
  })
})

describe('useQuizSettings：读坏数据不许炸', () => {
  it('坏 JSON / 空数组 / 全是非法题型 → 回默认', () => {
    localStorage.setItem('reader:quizKinds', 'not json')
    const a = renderHook(() => useQuizSettings())
    expect(a.result.current.kinds).toEqual(DEFAULT_QUIZ_KINDS)

    localStorage.setItem('reader:quizKinds', '[]')
    const b = renderHook(() => useQuizSettings())
    expect(b.result.current.kinds).toEqual(DEFAULT_QUIZ_KINDS)

    localStorage.setItem('reader:quizKinds', '["bogus",123]')
    const c = renderHook(() => useQuizSettings())
    expect(c.result.current.kinds).toEqual(DEFAULT_QUIZ_KINDS)
  })

  it('文章级题型表里混进词级题型 → 只留文章级', () => {
    localStorage.setItem('reader:quizArticleKinds', JSON.stringify(['translate', 'spell', 'ordering']))
    const { result } = renderHook(() => useQuizSettings())
    expect(result.current.articleKinds).toEqual(['translate', 'ordering'])
  })

  it('范围存了不认识的值 → 回 article', () => {
    localStorage.setItem('reader:quizScope', 'xxx')
    const { result } = renderHook(() => useQuizSettings())
    expect(result.current.scope).toBe('article')
  })
})

describe('useQuizSettings：写入能落盘', () => {
  it('改题型 / 题量 / 开关都写进 localStorage', () => {
    const { result } = renderHook(() => useQuizSettings())
    act(() => {
      result.current.setKinds(['meaning', 'ear'])
      result.current.setLimit(50)
      result.current.setAuto(true)
      result.current.setLoopWrong(true)
    })
    expect(JSON.parse(localStorage.getItem('reader:quizKinds')!)).toEqual(['meaning', 'ear'])
    expect(localStorage.getItem('reader:quizLimit')).toBe('50')
    expect(localStorage.getItem('reader:quizAuto')).toBe('1')
    expect(localStorage.getItem('reader:quizLoopWrong')).toBe('1')
    // 状态也要同步变（不然界面不动）
    expect(result.current.kinds).toEqual(['meaning', 'ear'])
    expect(result.current.limit).toBe(50)
  })
})
