// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { installFakeStorage } from '../testStorage'
import { createLibrary } from '../../core/vocab'
import { vocabItem } from '../../core/testFixtures'
import type { VocabLibrary } from '../../types/document'
import { useStudyPool, type UseStudyPoolOptions } from './useStudyPool'

/** 背单词设置与候选池：范围/牌组/新学复习过滤，以及到期数、新词数。 */
const past = new Date(0).toISOString()
const items: VocabLibrary['items'] = [
  vocabItem({ id: 'w1', word: 'one', lemma: 'one', meaning: '一' }),
  vocabItem({
    id: 'w2',
    word: 'two',
    lemma: 'two',
    meaning: '二',
    status: 'mastered',
    reviewState: { ...vocabItem().reviewState, repetitions: 2, due: past },
  }),
  vocabItem({ id: 'p1', word: 'run out', lemma: 'run out', kind: 'phrase', meaning: '耗尽' }),
  vocabItem({ id: 'u1', word: 'used to', lemma: 'used to', kind: 'usage', meaning: '过去常常' }),
  vocabItem({ id: 'w3', word: 'three', lemma: 'three', meaning: '三', source: { articleId: 'A', fileName: 'A', sentenceId: null, sentenceText: 'Three.' } }),
  vocabItem({ id: 'w4', word: 'run', lemma: 'run', meaning: '跑' }),
]

const library = (): VocabLibrary => ({ ...createLibrary(), items })

let restore: () => void = () => {}

function options(over: Partial<UseStudyPoolOptions> = {}): UseStudyPoolOptions {
  return { library: library(), articleIdentity: 'A', docLemmas: new Set<string>(), ...over }
}

beforeEach(() => {
  restore = installFakeStorage()
})

afterEach(() => {
  restore()
})

describe('useStudyPool：设置与候选池', () => {
  it('默认只背普通单词（词组/习语与用法笔记不进），新词数与到期数按范围算', () => {
    const { result } = renderHook(() => useStudyPool(options()))
    expect(result.current.deck).toBe('word')
    // 默认范围是「未掌握」，已掌握的 w2 不进来
    expect(result.current.pool.map((x) => x.id)).toEqual(['w1', 'w3', 'w4'])
    expect(result.current.newCount).toBe(3)
    expect(result.current.dueCount).toBe(0)
  })

  it('范围：未掌握 / 错词 / 本篇（来源或正文 lemma）', () => {
    const { result } = renderHook(() => useStudyPool(options({ docLemmas: new Set(['run']) })))

    act(() => result.current.setScope('unmastered'))
    expect(result.current.pool.map((x) => x.id)).toEqual(['w1', 'w3', 'w4'])

    act(() => result.current.setScope('lapses'))
    expect(result.current.pool).toEqual([])

    act(() => result.current.setScope('article'))
    expect(result.current.pool.map((x) => x.id)).toEqual(['w3', 'w4'])

    act(() => result.current.setScope('all'))
    expect(result.current.pool).toHaveLength(4)
    expect(result.current.dueCount).toBe(1)
  })

  it('牌组：切到背搭配只留词组/习语；poolFor 可临时换牌组', () => {
    const { result } = renderHook(() => useStudyPool(options()))
    act(() => result.current.setDeck('collocation'))
    expect(result.current.pool.map((x) => x.id)).toEqual(['p1'])
    expect(result.current.poolFor('all', 'word').map((x) => x.id)).toEqual(['w1', 'w2', 'w3', 'w4'])
  })
})
