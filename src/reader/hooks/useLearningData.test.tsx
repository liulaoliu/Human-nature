// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { installFakeStorage } from '../testStorage'
import { useLearningData } from './useLearningData'

let restoreStorage: () => void = () => {}

beforeEach(() => {
  restoreStorage = installFakeStorage()
})

afterEach(() => {
  restoreStorage()
  vi.restoreAllMocks()
})

const params = {
  articleIdentity: 'a1',
  articleTitle: 'A',
  articleKey: 'a1',
  todayKey: '2026-10-19',
  flash: () => {},
}

describe('useLearningData（学习记录唯一收口）', () => {
  it('初始为空；写入练习记录后按 learningState 的键落盘', () => {
    const { result } = renderHook(() => useLearningData(params))
    expect(result.current.practice).toEqual([])
    expect(result.current.data.activity).toEqual([])

    act(() =>
      result.current.setPractice([{ at: '2026-10-19T00:00:00.000Z', kind: 'quiz', total: 5, correct: 4 }]),
    )
    expect(JSON.parse(localStorage.getItem('reader:practice') ?? '[]')).toHaveLength(1)
    expect(result.current.data.practice).toHaveLength(1)
  })

  it('读完记录：markReadDone 写 reader:readDone，同一篇不重复', () => {
    const { result } = renderHook(() => useLearningData(params))
    act(() => result.current.markReadDone())
    expect(result.current.readDone).toHaveLength(1)
    expect(result.current.todayReadDone).toHaveLength(1)

    act(() => result.current.markReadDone())
    expect(result.current.readDone).toHaveLength(1)
  })

  it('旧格式 studiedToday（单个对象）被收成数组', () => {
    localStorage.setItem('reader:studiedToday', JSON.stringify({ day: '2026-10-18', ids: ['vocab:run'] }))
    const { result } = renderHook(() => useLearningData(params))
    expect(result.current.studiedDays).toEqual([{ day: '2026-10-18', ids: ['vocab:run'] }])
  })

  it('setters 与 data 指向同一份状态（合并导入用）', () => {
    const { result } = renderHook(() => useLearningData(params))
    act(() => result.current.setters.setSkimmed(['a1']))
    expect(result.current.data.skimmed).toEqual(['a1'])
    act(() => result.current.setters.setReadGoal(5))
    expect(result.current.data.readGoal).toBe(5)
  })
})
