// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import type { ListeningQuiz } from '../../core/listening'
import { listenMistake } from '../../core/mistakes'
import { installFakeStorage } from '../testStorage'
import { useListening, type UseListeningParams } from './useListening'

const KEY = 'reader:listening:file:a.md'

const quiz: ListeningQuiz = {
  questions: [
    { id: 'q1', type: 'mcq', stem: 'Q1', options: ['a', 'b'], answer: 'a' },
    { id: 'q2', type: 'short', stem: 'Q2', answer: 'x' },
  ],
}

function params(over: Partial<UseListeningParams> = {}): UseListeningParams {
  return {
    doc: { sentences: [{ id: 's1', text: 'Hello there.' }] },
    articleIdentity: 'file:a.md',
    flash: vi.fn(),
    setLastTask: vi.fn(),
    askedWordsRef: { current: ['old'] },
    askedIdsRef: { current: ['old'] },
    recordActivity: vi.fn(),
    recordPractice: vi.fn(),
    recordAnswer: vi.fn(),
    addMistake: vi.fn(),
    dropMistake: vi.fn(),
    closeOthers: vi.fn(),
    ...over,
  }
}

let restore: () => void = () => {}

beforeEach(() => {
  restore = installFakeStorage()
  Object.assign(navigator, { clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } })
})

afterEach(() => {
  restore()
  vi.restoreAllMocks()
})

describe('useListening：载入与开题', () => {
  it('localStorage 里的坏数据走 core 守卫 → 当作没有题', () => {
    localStorage.setItem(KEY, '{not json')
    const { result } = renderHook(() => useListening(params()))
    expect(result.current.quiz).toBeNull()
  })

  it('字段不合格的题整题丢弃（不会带坏形状进面板）', () => {
    localStorage.setItem(KEY, JSON.stringify({ questions: [{ id: 'bad' }] }))
    const { result } = renderHook(() => useListening(params()))
    expect(result.current.quiz).toBeNull()
  })

  it('合法题按文章载入', () => {
    localStorage.setItem(KEY, JSON.stringify(quiz))
    const { result } = renderHook(() => useListening(params()))
    expect(result.current.quiz?.questions).toHaveLength(2)
  })

  it('没有题时 start 复制提示词；有题时直接打开', async () => {
    const copy = params()
    const noQuiz = renderHook(() => useListening(copy))
    await act(async () => noQuiz.result.current.start())
    expect(copy.setLastTask).toHaveBeenCalledWith('listening')
    expect(copy.flash).toHaveBeenCalledWith(expect.stringContaining('已复制听力理解题提示词'))

    localStorage.setItem(KEY, JSON.stringify(quiz))
    const withQuiz = params()
    const loaded = renderHook(() => useListening(withQuiz))
    act(() => loaded.result.current.start())
    expect(withQuiz.closeOthers).toHaveBeenCalled()
    expect(loaded.result.current.open).toBe(true)
  })

  it('startQuestions：空数组不动作；指定题只考这些', () => {
    const p = params()
    const { result } = renderHook(() => useListening(p))
    act(() => result.current.startQuestions([]))
    expect(p.closeOthers).not.toHaveBeenCalled()

    act(() => result.current.startQuestions([quiz.questions[1]]))
    expect(result.current.open).toBe(true)
    expect(result.current.questions.map((q) => q.id)).toEqual(['q2'])
  })
})

describe('useListening：判分与错题', () => {
  it('判分：对题清错题、错题进错题本，并记录活动/练习', () => {
    localStorage.setItem(KEY, JSON.stringify(quiz))
    const p = params()
    const { result } = renderHook(() => useListening(p))
    act(() => result.current.showAll())
    act(() => result.current.setAnswers({ q1: 'a', q2: 'wrong' }))
    act(() => result.current.submit())

    expect(result.current.submitted).toBe(true)
    expect(result.current.result).toMatchObject({ total: 2, correct: 1 })
    expect(p.recordActivity).toHaveBeenCalledWith('listen', 2)
    expect(p.recordPractice).toHaveBeenCalledWith('listening', 2, 1)
    expect(p.recordAnswer).toHaveBeenCalledTimes(2)
    expect(p.recordAnswer).toHaveBeenCalledWith(
      expect.objectContaining({ articleId: 'file:a.md', source: 'listening', kind: 'listening', cat: 'listen', correct: true }),
    )
    expect(p.recordAnswer).toHaveBeenCalledWith(
      expect.objectContaining({ articleId: 'file:a.md', source: 'listening', kind: 'listening', cat: 'listen', correct: false }),
    )

    expect(p.dropMistake).toHaveBeenCalledWith(expect.stringContaining('q1'))
    expect(p.addMistake).toHaveBeenCalledWith(expect.objectContaining({ id: expect.stringContaining('q2') }))
    // 错题 id 与 core 口径一致
    expect(p.addMistake).toHaveBeenCalledWith(expect.objectContaining({ id: listenMistake('file:a.md', quiz.questions[1], '').id }))
  })

  it('retryWrong 只留错题；showAll 恢复全部', () => {
    localStorage.setItem(KEY, JSON.stringify(quiz))
    const { result } = renderHook(() => useListening(params()))
    act(() => result.current.setAnswers({ q1: 'a', q2: 'wrong' }))
    act(() => result.current.submit())
    act(() => result.current.retryWrong())
    expect(result.current.questions.map((q) => q.id)).toEqual(['q2'])

    act(() => result.current.showAll())
    expect(result.current.questions.map((q) => q.id)).toEqual(['q1', 'q2'])
  })
})
