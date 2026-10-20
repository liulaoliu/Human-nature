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

describe('useLearningData（写入动作，原来在 ReaderApp 里 wrap setter）', () => {
  it('markStudied：同一天同一个词只算一次，studiedTodayIds 跟着变', () => {
    const { result } = renderHook(() => useLearningData(params))
    act(() => result.current.markStudied('v1'))
    act(() => result.current.markStudied('v1'))
    act(() => result.current.markStudied('v2'))
    expect(result.current.studiedTodayIds).toEqual(['v1', 'v2'])
    expect(result.current.studiedDays).toHaveLength(1)
  })

  it('studyFlush：同一天累加秒数与张数，0 值不写', () => {
    const { result } = renderHook(() => useLearningData(params))
    act(() => result.current.studyFlush(0, 0))
    expect(result.current.studyDays).toHaveLength(0)
    act(() => result.current.studyFlush(30, 2))
    act(() => result.current.studyFlush(15, 3))
    expect(result.current.studyDays).toHaveLength(1)
    expect(result.current.studyDays[0].seconds).toBe(45)
    expect(result.current.studyDays[0].cards).toBe(5)
  })

  it('recordActivity：按分类累加，n<=0 不写', () => {
    const { result } = renderHook(() => useLearningData(params))
    act(() => result.current.recordActivity('speak', 0))
    expect(result.current.activity).toHaveLength(0)
    act(() => result.current.recordActivity('speak', 2))
    expect(result.current.activity[0].counts.speak).toBe(2)
  })

  it('recordPractice：total<=0 不记；记了就落在 reader:practice', () => {
    const { result } = renderHook(() => useLearningData(params))
    act(() => result.current.recordPractice('quiz', 0, 0))
    expect(result.current.practice).toHaveLength(0)
    act(() => result.current.recordPractice('quiz', 5, 4))
    expect(result.current.practice[0]).toMatchObject({ kind: 'quiz', total: 5, correct: 4, articleId: 'a1' })
    expect(JSON.parse(localStorage.getItem('reader:practice') ?? '[]')).toHaveLength(1)
  })

  it('mergeKindStats：按题型累加到本篇', () => {
    const { result } = renderHook(() => useLearningData(params))
    act(() => result.current.mergeKindStats([{ kind: 'spell', total: 3, correct: 2 }]))
    act(() => result.current.mergeKindStats([{ kind: 'spell', total: 2, correct: 1 }]))
    expect(result.current.kindStats.a1.spell).toEqual({ total: 5, correct: 3 })
  })

  it('mergeKindStats：没文章身份时不写（键是空的会污染 kindStats）', () => {
    localStorage.clear()
    const { result } = renderHook(() => useLearningData({ ...params, articleIdentity: '' }))
    act(() => result.current.mergeKindStats([{ kind: 'spell', total: 1, correct: 1 }]))
    expect(result.current.kindStats).toEqual({})
  })

  it('addMistake / dropMistake：加进去能按 id 删掉', () => {
    const { result } = renderHook(() => useLearningData(params))
    act(() => result.current.addMistake({ id: 'm1', kind: 'spell', word: 'quiet', at: '2026-10-19T00:00:00.000Z' } as never))
    expect(result.current.mistakes).toHaveLength(1)
    act(() => result.current.dropMistake('m1'))
    expect(result.current.mistakes).toHaveLength(0)
  })
})
