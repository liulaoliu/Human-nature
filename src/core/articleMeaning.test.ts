import { describe, it, expect } from 'vitest'
import { resolveArticleMeaning } from './articleMeaning'
import { vocabItem } from './testFixtures'
import type { ArticleVocabEntry, VocabItem } from '../types/document'

const entry = (over: Partial<ArticleVocabEntry> = {}): ArticleVocabEntry => ({
  articleId: 'A',
  lemma: 'bank',
  origin: 'manual',
  addedAt: '2026-10-01T00:00:00.000Z',
  ...over,
})

const item = (over: Partial<VocabItem> = {}) =>
  vocabItem({
    id: 'vocab:bank',
    word: 'bank',
    lemma: 'bank',
    meaning: '银行',
    contexts: [
      { articleId: 'A', fileName: 'A', sentenceId: 's1', sentenceText: 'river bank', meaning: '河岸', at: '2026-10-01T00:00:00.000Z' },
      { articleId: 'B', fileName: 'B', sentenceId: 's9', sentenceText: 'bank account', meaning: '银行账户', at: '2026-10-01T00:00:00.000Z' },
    ],
    ...over,
  })

describe('resolveArticleMeaning：本篇语境优先', () => {
  it('1. 本篇条目释义最高', () => {
    const r = resolveArticleMeaning(item(), entry({ meaning: '岸边（手改）' }), 'A', 's2')
    expect(r).toEqual({ text: '岸边（手改）', source: 'manual' })
  })

  it('2. 同句语境优先于同篇其他句', () => {
    const it = item({
      contexts: [
        { articleId: 'A', fileName: 'A', sentenceId: 's1', sentenceText: 'a', meaning: '甲', at: '2026-10-01T00:00:00.000Z' },
        { articleId: 'A', fileName: 'A', sentenceId: 's2', sentenceText: 'b', meaning: '乙', at: '2026-10-01T00:00:00.000Z' },
      ],
    })
    expect(resolveArticleMeaning(it, entry(), 'A', 's2')?.text).toBe('乙')
  })

  it('3. 同篇其他句的语境', () => {
    expect(resolveArticleMeaning(item(), entry(), 'A', 's3')?.text).toBe('河岸')
  })

  it('4. 全库主释义兜底（别的篇的语境不串）', () => {
    expect(resolveArticleMeaning(item(), entry(), 'C', 's1')?.text).toBe('银行')
  })

  it('没有任何释义 → null', () => {
    expect(resolveArticleMeaning(item({ meaning: null, contexts: [] }), entry(), 'A')).toBeNull()
  })
})
