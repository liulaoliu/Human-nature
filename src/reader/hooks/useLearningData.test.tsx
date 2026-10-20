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

  it('recordAnswer：每题追加一条事件，并落盘到 reader:answerEvents', () => {
    const { result } = renderHook(() => useLearningData(params))
    act(() =>
      result.current.recordAnswer({
        articleId: 'a1',
        source: 'quiz',
        kind: 'cloze',
        cat: 'vocab',
        correct: true,
        questionId: 'q1',
      }),
    )
    act(() =>
      result.current.recordAnswer({
        articleId: 'a1',
        source: 'quiz',
        kind: 'cloze',
        cat: 'vocab',
        correct: false,
        questionId: 'q2',
      }),
    )
    expect(result.current.answerEvents).toHaveLength(2)
    expect(result.current.answerEvents[1]).toMatchObject({ kind: 'cloze', correct: false, questionId: 'q2' })
    const stored = JSON.parse(localStorage.getItem('reader:answerEvents') ?? '[]')
    expect(stored).toHaveLength(2)
    expect(result.current.data.answerEvents).toHaveLength(2)
  })
})

describe('useLearningData：复述 / 略读动作', () => {
  it('saveRetell：去空白、记字数、写复述并记一次 write 活动', () => {
    const flash = vi.fn()
    const { result } = renderHook(() => useLearningData({ ...params, flash }))
    act(() => result.current.saveRetell('  hello brave new world  '))
    expect(result.current.retells).toHaveLength(1)
    expect(result.current.retells[0]).toMatchObject({
      articleId: 'a1',
      text: 'hello brave new world',
      words: 4,
    })
    expect(result.current.activity).toHaveLength(1)
    expect(result.current.activity[0].counts.write).toBe(1)
    expect(flash).toHaveBeenCalledWith('已记录复述 ✅')
  })

  it('saveRetell：空文本或没文章时不动', () => {
    const flash = vi.fn()
    const { result } = renderHook(() => useLearningData({ ...params, articleIdentity: null, flash }))
    act(() => result.current.saveRetell('hello'))
    expect(result.current.retells).toHaveLength(0)
    act(() => result.current.saveRetell('   '))
    expect(result.current.retells).toHaveLength(0)
    expect(flash).not.toHaveBeenCalled()
  })

  it('deleteRetell 只删指定时间那一条', () => {
    let t = 1_700_000_000_000
    const { result } = renderHook(() =>
      useLearningData({ ...params, now: () => new Date((t += 1000)) }),
    )
    act(() => result.current.saveRetell('first try'))
    const at = result.current.retells[0].at
    act(() => result.current.saveRetell('second try'))
    act(() => result.current.deleteRetell(at))
    expect(result.current.retells.map((r) => r.text)).toEqual(['second try'])
  })

  it('toggleSkimmed：同一篇来回切，只影响当前文章', () => {
    const { result } = renderHook(() => useLearningData(params))
    act(() => result.current.toggleSkimmed())
    expect(result.current.skimmedArticles).toEqual(['a1'])
    act(() => result.current.toggleSkimmed())
    expect(result.current.skimmedArticles).toEqual([])
  })
})
