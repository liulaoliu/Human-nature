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

describe('useGoldenLangPoint：语言点多选', () => {
  it('默认全选（练过的也勾上，想少练自己取消）', () => {
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
    expect(result.current.selected).toEqual(['come with', 'much of an improvement', 'not much of a'])
  })

  it('点一下取消 / 再点加回来，顺序按勾选先后', () => {
    const { result } = setup()
    expect(result.current.selected).toHaveLength(3)
    act(() => result.current.toggle('come with'))
    expect(result.current.selected).toEqual(['much of an improvement', 'not much of a'])
    act(() => result.current.toggle('come with'))
    expect(result.current.selected).toEqual(['much of an improvement', 'not much of a', 'come with'])
  })

  it('换句：清空回到新句的默认（不残留上一句的勾选）', () => {
    const { result, rerender } = setup()
    act(() => result.current.toggle('not much of a'))
    expect(result.current.selected).toHaveLength(2)
    const other = S({
      id: 's2',
      text: 'The news is grim.',
      languages: [{ phrases: ['be grim — 严峻'] }],
    })
    rerender({ s: other })
    expect(result.current.selected).toEqual(['be grim'])
  })

  it('本句没有语言点：空选择', () => {
    const { result } = setup({ sentence: S({ languages: [] }) })
    expect(result.current.choices).toEqual([])
    expect(result.current.selected).toEqual([])
    expect(result.current.sentence).toEqual({ id: 's1', text: 'The iPhone will come with a better camera.' })
  })
})
