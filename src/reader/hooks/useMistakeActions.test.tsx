// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { vocabItem } from '../../core/testFixtures'
import type { ListeningQuestion } from '../../core/listening'
import type { MistakeEntry } from '../../core/mistakes'
import type { VocabItem } from '../../types/document'
import { useMistakeActions, type UseMistakeActionsParams } from './useMistakeActions'

const mistake = (over: Partial<MistakeEntry>): MistakeEntry => ({
  id: 'm1',
  kind: 'vocab',
  at: '2026-10-19T00:00:00.000Z',
  count: 1,
  label: 'run',
  ...over,
})

const question: ListeningQuestion = { id: 'q1', type: 'mcq', stem: 'He ____.', options: ['runs', 'run'], answer: 'runs' }

function setup(over: Partial<UseMistakeActionsParams> = {}) {
  const startQuizItems = vi.fn()
  const startListenQuestions = vi.fn()
  const startDictItems = vi.fn()
  const setIntensiveOpen = vi.fn()
  const setQuizLoopWrong = vi.fn()
  const setQuizScope = vi.fn()
  const flash = vi.fn()
  const params: UseMistakeActionsParams = {
    mistakes: [],
    libraryItems: [],
    startQuizItems,
    startListenQuestions,
    startDictItems,
    setIntensiveOpen,
    setQuizLoopWrong,
    setQuizScope,
    flash,
    ...over,
  }
  const hook = renderHook(() => useMistakeActions(params))
  return {
    ...hook,
    startQuizItems,
    startListenQuestions,
    startDictItems,
    setIntensiveOpen,
    setQuizLoopWrong,
    setQuizScope,
    flash,
  }
}

const item = (over: Partial<VocabItem> = {}) => vocabItem({ id: 'v1', word: 'run', lemma: 'run', ...over })

describe('useMistakeActions：错题重练', () => {
  it('没有考试错词：只提示', () => {
    const { result, startQuizItems, flash } = setup({ mistakes: [mistake({ kind: 'listen' })] })
    act(() => result.current.retryMistakeVocab())
    expect(startQuizItems).not.toHaveBeenCalled()
    expect(flash).toHaveBeenCalledWith('没有考试错词')
  })

  it('考试错词：按 itemId 开一轮', () => {
    const { result, startQuizItems } = setup({
      mistakes: [mistake({ kind: 'vocab', itemId: 'v1' }), mistake({ id: 'm2', kind: 'vocab', itemId: 'v2' })],
    })
    act(() => result.current.retryMistakeVocab())
    expect(startQuizItems).toHaveBeenCalledWith(['v1', 'v2'])
  })

  it('听力错题：按题目重练；没有时提示', () => {
    const { result, startListenQuestions } = setup({
      mistakes: [mistake({ kind: 'listen', question }), mistake({ id: 'm2', kind: 'listen' })],
    })
    act(() => result.current.retryMistakeListen())
    expect(startListenQuestions).toHaveBeenCalledWith([question])

    const empty = setup()
    act(() => empty.result.current.retryMistakeListen())
    expect(empty.flash).toHaveBeenCalledWith('没有听力错题')
  })

  it('听写漏词：重新编号后重练；没有时提示', () => {
    const { result, startDictItems } = setup({
      mistakes: [mistake({ kind: 'dict', text: 'first' }), mistake({ id: 'm2', kind: 'dict', text: 'second' })],
    })
    act(() => result.current.retryMistakeDict())
    expect(startDictItems).toHaveBeenCalledWith([
      { id: 'mk-0', text: 'first' },
      { id: 'mk-1', text: 'second' },
    ])

    const empty = setup()
    act(() => empty.result.current.retryMistakeDict())
    expect(empty.flash).toHaveBeenCalledWith('没有听写漏词')
  })
})

describe('useMistakeActions：错题包围战', () => {
  it('没有可围剿的词：提示并留在面板里', () => {
    const { result, startQuizItems, setIntensiveOpen, flash } = setup({
      libraryItems: [item()],
      mistakes: [],
    })
    act(() => result.current.startSiege())
    expect(startQuizItems).not.toHaveBeenCalled()
    expect(setIntensiveOpen).not.toHaveBeenCalled()
    expect(flash).toHaveBeenCalledWith('错题本是空的 —— 先做几轮「考试 / 拷打」攒点错题吧')
  })

  it('有错词：关面板、开反复鞭打、按 lapses 范围出题', () => {
    const { result, startQuizItems, setIntensiveOpen, setQuizLoopWrong, setQuizScope, flash } = setup({
      libraryItems: [item()],
      mistakes: [mistake({ itemId: 'v1', count: 2 })],
    })
    act(() => result.current.startSiege())
    expect(setIntensiveOpen).toHaveBeenCalledWith(false)
    expect(setQuizLoopWrong).toHaveBeenCalledWith(true)
    expect(setQuizScope).toHaveBeenCalledWith('lapses')
    expect(startQuizItems).toHaveBeenCalledWith(
      ['v1'],
      ['spell', 'meaning', 'choice', 'usage', 'collocation', 'prep', 'idiom', 'cloze'],
    )
    expect(flash).toHaveBeenCalledWith('错题包围战：1 个欠揍的词，打到全对')
  })

  it('最多收 40 个词', () => {
    const libraryItems = Array.from({ length: 50 }, (_, i) => item({ id: `v${i}`, word: `w${i}`, lemma: `w${i}` }))
    const mistakes = libraryItems.map((it, i) => mistake({ id: `m${i}`, itemId: it.id }))
    const { result, startQuizItems, flash } = setup({ libraryItems, mistakes })
    act(() => result.current.startSiege())
    expect((startQuizItems.mock.calls[0][0] as string[]).length).toBe(40)
    expect(flash).toHaveBeenCalledWith('错题包围战：40 个欠揍的词，打到全对')
  })
})
