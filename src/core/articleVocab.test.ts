import { describe, it, expect } from 'vitest'
import {
  addArticleEntry,
  articleEntriesOf,
  articleEntryViews,
  articleItemsOf,
  markArticlePrinted,
  mergeArticleEntries,
  removeArticleEntry,
} from './articleVocab'
import { createLibrary, markWord } from './vocab'
import { vocabItem } from './testFixtures'
import type { VocabLibrary } from '../types/document'

const NOW = new Date('2026-10-20T00:00:00.000Z')

function lib(over: Partial<VocabLibrary> = {}): VocabLibrary {
  return { ...createLibrary(), ...over }
}

describe('addArticleEntry：按篇收录', () => {
  it('普通单词收进指定篇，编号顺序 = 数组顺序', () => {
    let l = lib({ items: [vocabItem({ id: 'v1', lemma: 'alpha' }), vocabItem({ id: 'v2', lemma: 'beta' })] })
    l = addArticleEntry(l, { articleId: 'A', lemma: 'beta', origin: 'auto' }, NOW)
    l = addArticleEntry(l, { articleId: 'A', lemma: 'alpha', origin: 'manual' }, NOW)
    expect(articleEntriesOf(l, 'A').map((e) => e.lemma)).toEqual(['beta', 'alpha'])
    expect(articleItemsOf(l, 'A').map((it) => it.lemma)).toEqual(['beta', 'alpha'])
  })

  it('写入细分来源；已有来源不被后来的动作覆盖', () => {
    let l = lib({ items: [vocabItem({ id: 'v1', lemma: 'alpha' })] })
    l = addArticleEntry(l, { articleId: 'A', lemma: 'alpha', origin: 'auto', via: 'dict' }, NOW)
    expect(articleEntriesOf(l, 'A')[0].via).toBe('dict')
    l = addArticleEntry(l, { articleId: 'A', lemma: 'alpha', origin: 'manual', via: 'manual' }, NOW)
    expect(articleEntriesOf(l, 'A')[0].via).toBe('dict')
  })

  it('旧条目没有 via：后来的动作可以补上，但不改 origin', () => {
    let l = lib({
      items: [vocabItem({ id: 'v1', lemma: 'alpha' })],
      articleEntries: [{ articleId: 'A', lemma: 'alpha', origin: 'manual', addedAt: NOW.toISOString() }],
    })
    l = addArticleEntry(l, { articleId: 'A', lemma: 'alpha', origin: 'auto', via: 'ai' }, NOW)
    expect(articleEntriesOf(l, 'A')[0]).toMatchObject({ origin: 'manual', via: 'ai' })
  })

  it('同篇同词只收一次，只补空着的语境，不改变顺序', () => {
    let l = lib({ items: [vocabItem({ id: 'v1', lemma: 'alpha' })] })
    l = addArticleEntry(l, { articleId: 'A', lemma: 'alpha', origin: 'auto' }, NOW)
    l = addArticleEntry(l, { articleId: 'A', lemma: 'alpha', origin: 'manual', sentenceId: 's1', sentenceText: 'A.' }, NOW)
    l = addArticleEntry(l, { articleId: 'A', lemma: 'alpha', origin: 'manual', sentenceId: 's2', sentenceText: 'B.' }, NOW)
    const entries = articleEntriesOf(l, 'A')
    expect(entries).toHaveLength(1)
    expect(entries[0].origin).toBe('auto')
    expect(entries[0].sentenceId).toBe('s1')
    expect(entries[0].sentenceText).toBe('A.')
  })

  it('已掌握词 / 不存在的词不收', () => {
    let l = lib({
      items: [
        vocabItem({ id: 'v1', lemma: 'done', status: 'mastered' }),
        vocabItem({ id: 'v2', lemma: 'take off', kind: 'phrase' }),
      ],
    })
    l = addArticleEntry(l, { articleId: 'A', lemma: 'done', origin: 'manual' }, NOW)
    l = addArticleEntry(l, { articleId: 'A', lemma: 'missing', origin: 'manual' }, NOW)
    expect(articleEntriesOf(l, 'A')).toEqual([])
  })

  it('语言点（词组 / 习语 / 用法）也能收进本篇，但不进单词编号', () => {
    let l = lib({ items: [vocabItem({ id: 'v1', lemma: 'take off', kind: 'phrase' })] })
    l = addArticleEntry(l, { articleId: 'A', lemma: 'take off', origin: 'auto' }, NOW)
    expect(articleEntriesOf(l, 'A')).toHaveLength(1)
    expect(articleItemsOf(l, 'A')).toEqual([])
  })

  it('同一词可以各自收进多篇，条目互不影响', () => {
    let l = lib({ items: [vocabItem({ id: 'v1', lemma: 'alpha' })] })
    l = addArticleEntry(l, { articleId: 'A', lemma: 'alpha', origin: 'auto', meaning: '甲' }, NOW)
    l = addArticleEntry(l, { articleId: 'B', lemma: 'alpha', origin: 'manual', meaning: '乙' }, NOW)
    expect(articleEntriesOf(l, 'A')[0].meaning).toBe('甲')
    expect(articleEntriesOf(l, 'B')[0].meaning).toBe('乙')
  })
})

describe('removeArticleEntry / markArticlePrinted', () => {
  it('从一篇删除只动这一篇，不影响全库和别的篇', () => {
    let l = lib({ items: [vocabItem({ id: 'v1', lemma: 'alpha' })] })
    l = addArticleEntry(l, { articleId: 'A', lemma: 'alpha', origin: 'manual' }, NOW)
    l = addArticleEntry(l, { articleId: 'B', lemma: 'alpha', origin: 'manual' }, NOW)
    l = removeArticleEntry(l, 'A', 'alpha')
    expect(articleEntriesOf(l, 'A')).toEqual([])
    expect(articleEntriesOf(l, 'B')).toHaveLength(1)
    expect(l.items).toHaveLength(1)
  })

  it('打印标记按篇独立', () => {
    let l = lib({ items: [vocabItem({ id: 'v1', lemma: 'alpha' })] })
    l = addArticleEntry(l, { articleId: 'A', lemma: 'alpha', origin: 'manual' }, NOW)
    l = addArticleEntry(l, { articleId: 'B', lemma: 'alpha', origin: 'manual' }, NOW)
    l = markArticlePrinted(l, 'A', ['alpha'], NOW)
    expect(articleEntriesOf(l, 'A')[0].printedAt).toBe(NOW.toISOString())
    expect(articleEntriesOf(l, 'B')[0].printedAt).toBeUndefined()
  })
})

describe('articleEntryViews / mergeArticleEntries', () => {
  it('按加入顺序过滤已掌握 / 非单词 / 缺失词，重复 lemma 只留第一条', () => {
    const l = lib({
      items: [
        vocabItem({ id: 'v1', lemma: 'alpha' }),
        vocabItem({ id: 'v2', lemma: 'done', status: 'mastered' }),
        vocabItem({ id: 'v3', lemma: 'take off', kind: 'phrase' }),
      ],
      articleEntries: [
        { articleId: 'A', lemma: 'alpha', origin: 'manual', addedAt: NOW.toISOString() },
        { articleId: 'A', lemma: 'done', origin: 'manual', addedAt: NOW.toISOString() },
        { articleId: 'A', lemma: 'take off', origin: 'manual', addedAt: NOW.toISOString() },
        { articleId: 'A', lemma: 'alpha', origin: 'auto', addedAt: NOW.toISOString() },
        { articleId: 'A', lemma: 'missing', origin: 'auto', addedAt: NOW.toISOString() },
      ],
    })
    expect(articleEntryViews(l, 'A').map((v) => v.item.lemma)).toEqual(['alpha'])
  })

  it('合并按篇条目：同篇同 lemma 保留本机，其余追加', () => {
    const a = [{ articleId: 'A', lemma: 'alpha', origin: 'manual' as const, addedAt: NOW.toISOString() }]
    const b = [
      { articleId: 'A', lemma: 'alpha', origin: 'auto' as const, addedAt: '2026-01-01T00:00:00.000Z' },
      { articleId: 'B', lemma: 'beta', origin: 'auto' as const, addedAt: NOW.toISOString() },
    ]
    const out = mergeArticleEntries(a, b)
    expect(out).toHaveLength(2)
    expect(out[0].origin).toBe('manual')
    expect(out[1].articleId).toBe('B')
  })
})

describe('markWord 写入按篇条目', () => {
  it('普通单词自动 / 手动都收进当前篇；词组不进', () => {
    let l = createLibrary()
    l = markWord(l, { word: 'alpha', articleId: 'A', fileName: 'A', origin: 'auto', via: 'dict' }, NOW).library
    l = markWord(l, { word: 'beta', articleId: 'A', fileName: 'A', via: 'manual' }, NOW).library
    l = markWord(l, { word: 'take off', articleId: 'A', fileName: 'A' }, NOW).library
    expect(articleEntriesOf(l, 'A')).toHaveLength(2)
    expect(articleEntriesOf(l, 'A').map((e) => e.origin)).toEqual(['auto', 'manual'])
    expect(articleEntriesOf(l, 'A').map((e) => e.via)).toEqual(['dict', 'manual'])
  })
})
