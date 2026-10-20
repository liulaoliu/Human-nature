// @vitest-environment jsdom
import { renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { useArticleVocabView } from './useArticleVocabView'
import { sentenceFixture, vocabItem } from '../../core/testFixtures'
import type { ArticleVocabEntry, VocabItem, VocabLibrary } from '../../types/document'

const lib = (items: VocabItem[], articleEntries: ArticleVocabEntry[] = []): VocabLibrary => ({
  schemaVersion: 7,
  items,
  articleEntries,
})

const entry = (lemma: string, origin: 'auto' | 'manual' = 'manual', printedAt?: string): ArticleVocabEntry => ({
  articleId: 'art-A',
  lemma,
  origin,
  addedAt: '2026-01-01T00:00:00.000Z',
  printedAt,
})

const base = {
  articleIdentity: 'art-A',
  sentences: null,
}

describe('useArticleVocabView（本篇生词口径）', () => {
  it('只显示显式收进本篇的条目，总词库其他词不继承', () => {
    const library = lib(
      [
        vocabItem({ id: 'v1', word: 'mitigate', lemma: 'mitigate' }),
        vocabItem({ id: 'v2', word: 'other', lemma: 'other' }),
      ],
      [entry('mitigate', 'auto')],
    )
    const { result } = renderHook(() => useArticleVocabView({ ...base, library }))
    expect(result.current.articleWords.map((it) => it.lemma)).toEqual(['mitigate'])
    expect(result.current.articleOrigins.get('mitigate')).toBe('auto')
  })

  it('同一词在别的篇有记录、正文也出现，也不会自动算本篇', () => {
    const library = lib(
      [vocabItem({ id: 'v2', word: 'quiet', lemma: 'quiet' })],
      [{ ...entry('quiet'), articleId: 'art-B' }],
    )
    const { result } = renderHook(() =>
      useArticleVocabView({ ...base, library, sentences: [sentenceFixture('s1', 'A quiet morning.')] }),
    )
    expect(result.current.articleWords).toEqual([])
    expect(result.current.articleNums.size).toBe(0)
  })

  it('已掌握词不显示；词组显示在语言点里但不进编号', () => {
    const library = lib(
      [
        vocabItem({ id: 'v1', lemma: 'alpha', status: 'mastered' }),
        vocabItem({ id: 'v2', lemma: 'take off', word: 'take off', kind: 'phrase' }),
        vocabItem({ id: 'v3', lemma: 'beta' }),
      ],
      [entry('alpha'), entry('take off'), entry('beta')],
    )
    const { result } = renderHook(() => useArticleVocabView({ ...base, library }))
    expect(result.current.articleWords.map((it) => it.lemma)).toEqual(['take off', 'beta'])
    expect(result.current.articleNums.get('take off')).toBeUndefined()
    expect(result.current.articleNums.get('beta')).toBe(1)
  })

  it('knownLemmas 只覆盖本篇（速读判断「这篇已收录」）', () => {
    const library = lib(
      [vocabItem({ id: 'v1', lemma: 'alpha' }), vocabItem({ id: 'v2', lemma: 'beta' })],
      [entry('alpha')],
    )
    const { result } = renderHook(() => useArticleVocabView({ ...base, library }))
    expect(result.current.knownLemmas.has('alpha')).toBe(true)
    expect(result.current.knownLemmas.has('beta')).toBe(false)
    expect(result.current.knownLemmas.has('gamma')).toBe(false)
  })

  it('语言点句数只数有语言点的句子', () => {
    const sentences = [
      sentenceFixture('s1', 'A.', { language: { structure: '主句 + 从句' } }),
      sentenceFixture('s2', 'B.'),
      sentenceFixture('s3', 'C.', { language: { phrases: ['take off'] } }),
    ]
    const { result } = renderHook(() => useArticleVocabView({ ...base, library: lib([]), sentences }))
    expect(result.current.languageSentCount).toBe(2)
  })

  it('wordsInSentence 只返回本篇且该句出现过的词', () => {
    const library = lib(
      [
        vocabItem({ id: 'v1', word: 'run', lemma: 'run' }),
        vocabItem({ id: 'v2', word: 'fast', lemma: 'fast' }),
        vocabItem({ id: 'v3', word: 'other', lemma: 'other' }),
      ],
      [entry('run'), entry('fast'), { ...entry('other'), articleId: 'art-B' }],
    )
    const sentences = [sentenceFixture('s1', 'I run.'), sentenceFixture('s2', 'Very fast.')]
    const { result } = renderHook(() => useArticleVocabView({ ...base, library, sentences }))
    expect(result.current.wordsInSentence('s1')).toEqual(['run'])
    expect(result.current.wordsInSentence('s2')).toEqual(['fast'])
  })

  it('打印口径读按篇条目的 printedAt，不拿全库 lastPrintedAt 冒充', () => {
    const library = lib(
      [
        vocabItem({ id: 'v1', lemma: 'alpha', lastPrintedAt: '2020-01-01T00:00:00.000Z' }),
        vocabItem({ id: 'v2', lemma: 'beta' }),
      ],
      [entry('alpha', 'manual', '2026-10-01T00:00:00.000Z'), entry('beta', 'manual', '2026-10-05T00:00:00.000Z')],
    )
    const { result } = renderHook(() => useArticleVocabView({ ...base, library }))
    expect(result.current.articlePrintedAt).toBe('2026-10-05T00:00:00.000Z')
    expect(result.current.articleAllPrinted).toBe(true)
  })

  it('有一个没打印过就不算「全部打印过」', () => {
    const library = lib(
      [vocabItem({ id: 'v1', lemma: 'alpha' }), vocabItem({ id: 'v2', lemma: 'beta' })],
      [entry('alpha', 'manual', '2026-10-01T00:00:00.000Z'), entry('beta')],
    )
    const { result } = renderHook(() => useArticleVocabView({ ...base, library }))
    expect(result.current.articleAllPrinted).toBe(false)
  })

  it('一篇生词都没有：没有打印时间、也不算全部打印过（空集不该说「都打印了」）', () => {
    const { result } = renderHook(() => useArticleVocabView({ ...base, library: lib([]) }))
    expect(result.current.articlePrintedAt).toBeNull()
    expect(result.current.articleAllPrinted).toBe(false)
  })

  it('编号按加入顺序；正文首次出现的位置仍可标上标', () => {
    const sentences = [sentenceFixture('s1', 'The quiet morning came.')]
    const library = lib(
      [vocabItem({ id: 'v1', lemma: 'quiet', word: 'quiet' })],
      [{ ...entry('quiet'), addedAt: '2026-01-01T00:00:00.000Z' }],
    )
    const { result } = renderHook(() => useArticleVocabView({ ...base, library, sentences }))
    expect(result.current.articleNums.get('quiet')).toBe(1)
    // firstOccurrence 记的是「句 id:词序号」，不是 lemma
    expect(result.current.articleFirst.has('s1:1')).toBe(true)
  })

  it('删除中间条目后编号紧凑重排', () => {
    const library = lib(
      [
        vocabItem({ id: 'v1', lemma: 'alpha' }),
        vocabItem({ id: 'v2', lemma: 'beta' }),
        vocabItem({ id: 'v3', lemma: 'gamma' }),
      ],
      [entry('alpha'), entry('gamma')],
    )
    const { result } = renderHook(() => useArticleVocabView({ ...base, library }))
    expect([...result.current.articleNums.entries()]).toEqual([
      ['alpha', 1],
      ['gamma', 2],
    ])
  })

  it('悬浮释义优先本篇条目，其次同句语境，最后全库主释义', () => {
    const item = vocabItem({
      id: 'v1',
      word: 'bank',
      lemma: 'bank',
      meaning: '银行',
      contexts: [{ articleId: 'A', fileName: 'art-A', sentenceId: 's1', sentenceText: 'river bank', meaning: '河岸', at: '2026-01-01T00:00:00.000Z' }],
    })
    const own = lib([item], [{ ...entry('bank'), meaning: '岸边（本篇手改）' }])
    const a = renderHook(() => useArticleVocabView({ ...base, library: own }))
    expect(a.result.current.meaningOf('bank', 's1')).toBe('岸边（本篇手改）')

    const ctx = lib([item], [entry('bank')])
    const b = renderHook(() => useArticleVocabView({ ...base, library: ctx }))
    expect(b.result.current.meaningOf('bank', 's1')).toBe('河岸')

    const fallback = lib([vocabItem({ id: 'v1', word: 'bank', lemma: 'bank', meaning: '银行' })], [entry('bank')])
    const c = renderHook(() => useArticleVocabView({ ...base, library: fallback }))
    expect(c.result.current.meaningOf('bank', 's2')).toBe('银行')
  })

  it('没加载文章时不炸', () => {
    vi.spyOn(console, 'error')
    const { result } = renderHook(() => useArticleVocabView({ ...base, library: lib([]), sentences: null }))
    expect(result.current.articleWords).toEqual([])
    expect(result.current.languageSentCount).toBe(0)
  })
})
