// @vitest-environment jsdom
import { renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { useArticleVocabView } from './useArticleVocabView'
import { sentenceFixture, vocabItem } from '../../core/testFixtures'
import type { VocabLibrary } from '../../types/document'

const lib = (items: VocabLibrary['items']): VocabLibrary => ({ schemaVersion: 7, items })

const base = {
  articleIdentity: 'art-A',
  docLemmas: new Set<string>(),
  sentences: null,
}

describe('useArticleVocabView（本篇生词口径）', () => {
  it('来源是本文的词算本篇', () => {
    const library = lib([
      vocabItem({ id: 'v1', word: 'mitigate', lemma: 'mitigate', source: { fileName: 'art-A', sentenceId: 's1' } }),
      vocabItem({ id: 'v2', word: 'other', lemma: 'other', source: { fileName: 'art-B', sentenceId: 's9' } }),
    ])
    const { result } = renderHook(() => useArticleVocabView({ ...base, library }))
    expect(result.current.articleWords.map((it) => it.lemma)).toEqual(['mitigate'])
  })

  it('正文里出现过的词也算（别的文章带过来、来源还留在那边）', () => {
    const library = lib([
      vocabItem({ id: 'v2', word: 'quiet', lemma: 'quiet', source: { fileName: 'art-B', sentenceId: 's9' } }),
    ])
    const { result } = renderHook(() =>
      useArticleVocabView({ ...base, library, docLemmas: new Set(['quiet']) }),
    )
    expect(result.current.articleWords.map((it) => it.lemma)).toEqual(['quiet'])
  })

  it('knownLemmas 覆盖整个词库（速读里判断「已收录」）', () => {
    const library = lib([
      vocabItem({ id: 'v1', lemma: 'alpha' }),
      vocabItem({ id: 'v2', lemma: 'beta' }),
    ])
    const { result } = renderHook(() => useArticleVocabView({ ...base, library }))
    expect(result.current.knownLemmas.has('alpha')).toBe(true)
    expect(result.current.knownLemmas.has('beta')).toBe(true)
    expect(result.current.knownLemmas.has('gamma')).toBe(false)
  })

  it('语言点句数只数有语言点的句子', () => {
    const sentences = [
      sentenceFixture('s1', 'A.', { language: { structure: '主句 + 从句' } }),
      sentenceFixture('s2', 'B.'),
      sentenceFixture('s3', 'C.', { language: { phrases: ['take off'] } }),
    ]
    const { result } = renderHook(() =>
      useArticleVocabView({ ...base, library: lib([]), sentences }),
    )
    expect(result.current.languageSentCount).toBe(2)
  })

  it('wordsInSentence 只返回本篇 + 该句来源的词', () => {
    const library = lib([
      vocabItem({ id: 'v1', word: 'run', lemma: 'run', source: { fileName: 'art-A', sentenceId: 's1' } }),
      vocabItem({ id: 'v2', word: 'fast', lemma: 'fast', source: { fileName: 'art-A', sentenceId: 's2' } }),
      vocabItem({ id: 'v3', word: 'other', lemma: 'other', source: { fileName: 'art-B', sentenceId: 's1' } }),
    ])
    const { result } = renderHook(() => useArticleVocabView({ ...base, library }))
    expect(result.current.wordsInSentence('s1')).toEqual(['run'])
    expect(result.current.wordsInSentence('s2')).toEqual(['fast'])
  })

  it('打印口径：最近打印时间 + 是否全部打印过', () => {
    const library = lib([
      vocabItem({ id: 'v1', lemma: 'alpha', source: { fileName: 'art-A', sentenceId: 's1' }, lastPrintedAt: '2026-10-01T00:00:00.000Z' }),
      vocabItem({ id: 'v2', lemma: 'beta', source: { fileName: 'art-A', sentenceId: 's2' }, lastPrintedAt: '2026-10-05T00:00:00.000Z' }),
    ])
    const { result } = renderHook(() => useArticleVocabView({ ...base, library }))
    expect(result.current.articlePrintedAt).toBe('2026-10-05T00:00:00.000Z')
    expect(result.current.articleAllPrinted).toBe(true)
  })

  it('有一个没打印过就不算「全部打印过」', () => {
    const library = lib([
      vocabItem({ id: 'v1', lemma: 'alpha', source: { fileName: 'art-A', sentenceId: 's1' }, lastPrintedAt: '2026-10-01T00:00:00.000Z' }),
      vocabItem({ id: 'v2', lemma: 'beta', source: { fileName: 'art-A', sentenceId: 's2' } }),
    ])
    const { result } = renderHook(() => useArticleVocabView({ ...base, library }))
    expect(result.current.articleAllPrinted).toBe(false)
  })

  it('一篇生词都没有：没有打印时间、也不算全部打印过（空集不该说「都打印了」）', () => {
    const { result } = renderHook(() => useArticleVocabView({ ...base, library: lib([]) }))
    expect(result.current.articlePrintedAt).toBeNull()
    expect(result.current.articleAllPrinted).toBe(false)
  })

  it('编号：正文里第一次出现的词标记在 articleFirst 里', () => {
    const sentences = [sentenceFixture('s1', 'The quiet morning came.')]
    const library = lib([vocabItem({ id: 'v1', lemma: 'quiet', word: 'quiet', source: { fileName: 'art-A', sentenceId: 's1' } })])
    const { result } = renderHook(() =>
      useArticleVocabView({ ...base, library, sentences, docLemmas: new Set(['quiet']) }),
    )
    expect(result.current.articleNums.get('quiet')).toBe(1)
    // firstOccurrence 记的是「句 id:词序号」，不是 lemma
    expect(result.current.articleFirst.has('s1:1')).toBe(true)
  })

  it('没加载文章时不炸', () => {
    vi.spyOn(console, 'error')
    const { result } = renderHook(() => useArticleVocabView({ ...base, library: lib([]), sentences: null }))
    expect(result.current.articleWords).toEqual([])
    expect(result.current.languageSentCount).toBe(0)
  })
})
