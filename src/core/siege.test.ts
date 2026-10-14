import { describe, it, expect } from 'vitest'
import { buildSiege } from './siege'
import type { MistakeEntry } from './mistakes'
import type { VocabItem } from '../types/document'

const NOW = new Date('2026-10-15T00:00:00Z')

function item(over: Partial<VocabItem> = {}): VocabItem {
  return {
    id: 'vocab:run',
    word: 'run',
    lemma: 'run',
    phonetic: null,
    partOfSpeech: 'v.',
    meaning: '跑',
    usage: [],
    examples: [],
    source: null,
    status: 'queried',
    note: '',
    tags: [],
    reviewState: { ease: 2.5, due: null, interval: 0, repetitions: 0 },
    createdAt: NOW.toISOString(),
    updatedAt: NOW.toISOString(),
    ...over,
  }
}

const mistake = (itemId: string, count = 1): MistakeEntry => ({
  id: `vocab:${itemId}`,
  kind: 'vocab',
  at: NOW.toISOString(),
  count,
  label: itemId,
  itemId,
})

describe('buildSiege', () => {
  it('空库 / 无错无优先 → 不围剿', () => {
    expect(buildSiege([], [], { now: NOW })).toHaveLength(0)
    expect(buildSiege([item()], [], { now: NOW })).toHaveLength(0)
  })

  it('错题 + 优先 + 常错 + 学不稳 都会被收，按轻重排序', () => {
    const items: VocabItem[] = [
      item({ id: 'vocab:a', lemma: 'a', reviewState: { ease: 2.5, due: null, interval: 3, repetitions: 1, lapses: 2 } }),
      item({ id: 'vocab:b', lemma: 'b', priorityUntil: '2026-10-16T00:00:00Z' }),
      item({ id: 'vocab:c', lemma: 'c' }),
    ]
    const out = buildSiege(items, [mistake('vocab:a', 3)], { now: NOW })
    expect(out.map((x) => x.item.id)).toEqual(['vocab:a', 'vocab:b'])
    expect(out[0].reason).toContain('错过 3 次')
    expect(out[0].reason).toContain('忘记 2 次')
    expect(out[1].reason).toContain('优先重练')
  })

  it('错得越多 / lapses 越多，排得越前', () => {
    const items = [
      item({ id: 'vocab:few', lemma: 'few' }),
      item({ id: 'vocab:many', lemma: 'many' }),
    ]
    const out = buildSiege(items, [mistake('vocab:few', 1), mistake('vocab:many', 4)], { now: NOW })
    expect(out[0].item.id).toBe('vocab:many')
  })

  it('scope=article 只看本篇', () => {
    const items = [
      item({ id: 'vocab:x', lemma: 'x', source: { articleId: 'art-A', fileName: 'art-A', sentenceId: 's1', sentenceText: 'X.' } }),
      item({ id: 'vocab:y', lemma: 'y', source: { articleId: 'art-B', fileName: 'art-B', sentenceId: 's1', sentenceText: 'Y.' } }),
    ]
    const ms = [mistake('vocab:x'), mistake('vocab:y')]
    expect(buildSiege(items, ms, { now: NOW, scope: 'article', articleIdentity: 'art-A' }).map((z) => z.item.id)).toEqual([
      'vocab:x',
    ])
  })

  it('limit 生效', () => {
    const items = [item({ id: 'vocab:a', lemma: 'a' }), item({ id: 'vocab:b', lemma: 'b' })]
    const ms = [mistake('vocab:a', 5), mistake('vocab:b', 1)]
    expect(buildSiege(items, ms, { now: NOW, limit: 1 })).toHaveLength(1)
  })
})
