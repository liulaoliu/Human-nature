// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { useGoldenLangPoint } from './useGoldenLangPoint'
import type { Sentence } from '../../types/document'

const S = (over: Partial<Sentence> = {}): Sentence => ({
  id: 's1',
  paraId: 'p01',
  text: 'The iPhone will come with a better camera.',
  audio: null,
  translation: null,
  grammarNote: null,
  collocations: [],
  vocab: [],
  tags: [],
  reviewState: { ease: 2.5, due: null, interval: 0, repetitions: 0 },
  ...over,
})

const sentence = S({
  languages: [
    {
      phrases: ['come with — 配备，附带', 'much of an improvement — 很大的改进'],
      idioms: ['not much of a — 算不上好的'],
    },
  ],
})

function setup(over: { sentence?: Sentence | null; history?: unknown[] } = {}) {
  const flash = vi.fn()
  const recordActivity = vi.fn()
  const setWritingHistory = vi.fn()
  const hook = renderHook(
    ({ s }: { s: Sentence | null }) =>
      useGoldenLangPoint({
        sentence: s,
        articleId: 'a1',
        articleTitle: 'A',
        writingHistory: (over.history ?? []) as never,
        setWritingHistory,
        flash,
        recordActivity,
      }),
    { initialProps: { s: over.sentence === undefined ? sentence : over.sentence } },
  )
  return { ...hook, flash, recordActivity, setWritingHistory }
}

describe('useGoldenLangPoint：单点造句', () => {
  it('默认选第一个没练过的；题面只要求用这一个词块', () => {
    const { result } = setup({
      history: [
        { articleId: 'a1', sentenceId: 's1', task: { focus: 'come with' }, text: 'x', at: '', feedback: {} },
      ],
    })
    expect(result.current.choices.map((c) => c.en)).toEqual([
      'come with',
      'much of an improvement',
      'not much of a',
    ])
    expect(result.current.active).toBe('much of an improvement')
    expect(result.current.imitation.current?.mustUse).toEqual(['much of an improvement'])
    expect(result.current.imitation.current?.task).toContain('much of an improvement')
  })

  it('点别的语言点会切换题目，答案随之清空', () => {
    const { result } = setup()
    act(() => result.current.imitation.setAnswer('my sentence'))
    expect(result.current.imitation.answer).toBe('my sentence')
    act(() => result.current.select('not much of a'))
    expect(result.current.active).toBe('not much of a')
    expect(result.current.imitation.current?.mustUse).toEqual(['not much of a'])
    expect(result.current.imitation.answer).toBe('')
  })

  it('本句没有语言点：不给题，也不炸', () => {
    const { result } = setup({ sentence: S({ languages: [] }) })
    expect(result.current.choices).toEqual([])
    expect(result.current.active).toBeNull()
    expect(result.current.imitation.current).toBeNull()
  })
})
