// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { renderHook } from '@testing-library/react'
import {
  activeLemmasOf,
  allLemmas,
  libraryLemmaSet,
  sentenceLemmaSets,
  vocabSentenceIds,
} from '../../core/vocabSets'
import { sentenceFixture, vocabItem } from '../../core/testFixtures'
import { useDocVocabSets } from './useDocVocabSets'

const sentences = [
  sentenceFixture('s1', 'The runner runs fast.'),
  sentenceFixture('s2', 'A quiet walk.'),
]

describe('useDocVocabSets', () => {
  it('接线结果与 core 规则一致（句子/全文/生词句）', () => {
    const items = [
      vocabItem({ id: 'v1', word: 'run', lemma: 'run' }),
      vocabItem({ id: 'v2', word: 'walk', lemma: 'walk' }),
      vocabItem({ id: 'v3', word: 'quiet', lemma: 'quiet', status: 'mastered' }),
    ]
    const batch = new Set(['s2'])
    const { result } = renderHook(() => useDocVocabSets({ sentences, articleItems: items, batchSentenceIds: batch }))

    const lemmas = sentenceLemmaSets(sentences)
    expect(result.current.sentenceLemmas).toEqual(lemmas)
    expect(result.current.docLemmas).toEqual(allLemmas(lemmas))
    expect(result.current.activeLemmas).toEqual(activeLemmasOf(items))
    expect(result.current.libraryLemmas).toEqual(libraryLemmaSet(items))
    expect(result.current.vocabSids).toEqual(
      vocabSentenceIds(sentences, lemmas, activeLemmasOf(items), batch),
    )
    expect(result.current.vocabSidSet).toEqual(new Set(result.current.vocabSids))
  })

  it('没有文章时返回空集合，不报错', () => {
    const { result } = renderHook(() =>
      useDocVocabSets({ sentences: null, articleItems: [], batchSentenceIds: new Set() }),
    )
    expect(result.current.sentenceLemmas.size).toBe(0)
    expect(result.current.docLemmas.size).toBe(0)
    expect(result.current.vocabSids).toEqual([])
    expect(result.current.vocabSidSet.size).toBe(0)
  })

  it('已掌握词不再算生词，但仍在「已在生词本」集合里', () => {
    const items = [vocabItem({ id: 'v1', word: 'quick', lemma: 'quick', status: 'mastered' })]
    const { result } = renderHook(() =>
      useDocVocabSets({
        sentences: [sentenceFixture('s1', 'A quick run.')],
        articleItems: items,
        batchSentenceIds: new Set(),
      }),
    )
    expect(result.current.activeLemmas.has('quick')).toBe(false)
    expect(result.current.libraryLemmas.has('quick')).toBe(true)
    expect(result.current.vocabSids).toEqual([])
  })
})
