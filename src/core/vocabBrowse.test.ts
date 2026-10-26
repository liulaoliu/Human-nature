import { describe, expect, it } from 'vitest'
import { dayKeyLocal } from './activity'
import { vocabItem } from './testFixtures'
import { defaultReviewState } from '../types/document'
import type { ArticleVocabEntry } from '../types/document'
import { browseVocab, browseA4Rows } from './vocabBrowse'

/**
 * 生词浏览页的筛选口径（纯函数）。
 * 本篇 / 选篇的归属只认 `articleEntries`（和侧栏、打印同一份口径）。
 */

const at = (y: number, m: number, d: number, h = 12) => new Date(y, m - 1, d, h).toISOString()

const alpha = vocabItem({
  id: 'v-alpha',
  word: 'alpha',
  lemma: 'alpha',
  meaning: '阿尔法',
  createdAt: at(2026, 10, 1),
})
const beta = vocabItem({
  id: 'v-beta',
  word: 'beta',
  lemma: 'beta',
  meaning: '贝塔',
  note: '希腊字母',
  createdAt: at(2026, 10, 2),
})
const done = vocabItem({
  id: 'v-done',
  word: 'done',
  lemma: 'done',
  status: 'mastered',
  createdAt: at(2026, 10, 2),
})
const take = vocabItem({
  id: 'v-take',
  word: 'take off',
  lemma: 'take off',
  kind: 'phrase',
  meaning: '起飞',
  createdAt: at(2026, 10, 3),
})
const gamma = vocabItem({
  id: 'v-gamma',
  word: 'gamma',
  lemma: 'gamma',
  createdAt: at(2026, 10, 3),
})

const entry = (articleId: string, lemma: string): ArticleVocabEntry => ({
  articleId,
  lemma,
  origin: 'manual',
  addedAt: at(2026, 10, 1),
})

const entries: ArticleVocabEntry[] = [
  entry('a-key', 'alpha'),
  entry('a-key', 'take off'),
  entry('a-key', 'gamma'),
  entry('a-key', 'alpha'), // 重复 lemma
  entry('b-key', 'beta'),
  entry('b-key', 'done'),
  entry('c-key', 'gamma'),
]

const items = [alpha, beta, done, take, gamma]
const articles = [
  { id: 'saved:A', title: 'A 篇', aliases: ['a-key', 'A'] },
  { id: 'saved:B', title: 'B 篇', aliases: ['b-key'] },
  { id: 'saved:C', title: 'C 篇', aliases: ['c-key'] },
]

const base = {
  items,
  articleEntries: entries,
  articles,
  articleId: 'a-key',
  kind: 'all' as const,
  query: '',
  includeMastered: false,
}

describe('browseVocab：范围', () => {
  it('全部：默认不含已掌握；勾选后包含', () => {
    expect(browseVocab({ ...base, scope: 'all' }).items.map((it) => it.lemma)).toEqual([
      'alpha', 'beta', 'take off', 'gamma',
    ])
    expect(
      browseVocab({ ...base, scope: 'all', includeMastered: true }).items.map((it) => it.lemma),
    ).toContain('done')
  })

  it('本篇：只认按篇收录，别名合并、同 lemma 去重、语言点也在', () => {
    const out = browseVocab({ ...base, scope: 'article' })
    expect(out.items.map((it) => it.lemma)).toEqual(['alpha', 'take off', 'gamma'])
    expect(out.scopeCount).toBe(3)
  })

  it('本篇：含已掌握时把 mastered 也带出来', () => {
    const out = browseVocab({ ...base, scope: 'article', articleId: 'b-key', includeMastered: true })
    expect(out.items.map((it) => it.lemma)).toEqual(['beta', 'done'])
  })

  it('选篇：只并选中的篇，按 lemma 去重；给出每篇条数', () => {
    const out = browseVocab({
      ...base,
      scope: 'picked',
      pickedArticleIds: new Set(['saved:A', 'saved:C']),
      includeMastered: true,
    })
    expect(out.items.map((it) => it.lemma)).toEqual(['alpha', 'take off', 'gamma'])
    expect(out.articleCounts.get('saved:A')).toBe(3)
    expect(out.articleCounts.get('saved:C')).toBe(1)
    expect(out.articleCounts.get('saved:B')).toBe(2)
  })

  it('没开文章 / 没选篇：空结果，不报错', () => {
    expect(browseVocab({ ...base, scope: 'article', articleId: '' }).items).toEqual([])
    expect(browseVocab({ ...base, scope: 'picked', pickedArticleIds: new Set() }).items).toEqual([])
  })
})

describe('browseVocab：类型 / 搜索 / 日期', () => {
  it('类型：生词只要普通单词，语言点只要词组/习语/用法', () => {
    expect(browseVocab({ ...base, scope: 'all', kind: 'word' }).items.map((it) => it.lemma)).not.toContain('take off')
    expect(browseVocab({ ...base, scope: 'all', kind: 'lang' }).items.map((it) => it.lemma)).toEqual(['take off'])
  })

  it('搜索：词形 / 释义 / 笔记，大小写不敏感', () => {
    expect(browseVocab({ ...base, scope: 'all', query: 'ALP' }).items.map((it) => it.lemma)).toEqual(['alpha'])
    expect(browseVocab({ ...base, scope: 'all', query: '贝塔' }).items.map((it) => it.lemma)).toEqual(['beta'])
    expect(browseVocab({ ...base, scope: 'all', query: '希腊' }).items.map((it) => it.lemma)).toEqual(['beta'])
  })

  it('日期：按入库日（04:00 结算）分天，倒序 + 条数', () => {
    const early = vocabItem({ id: 'v-early', word: 'early', lemma: 'early', createdAt: at(2026, 10, 2, 3) })
    const out = browseVocab({ ...base, items: [...items, early], scope: 'all' })
    const d1 = dayKeyLocal(new Date(at(2026, 10, 1)))
    const d2 = dayKeyLocal(new Date(at(2026, 10, 2, 12)))
    const d3 = dayKeyLocal(new Date(at(2026, 10, 3)))
    expect(out.days[0]).toEqual([d3, 2]) // take off + gamma
    expect(out.days).toContainEqual([d2, 1]) // beta（done 已掌握被排除）
    expect(out.days).toContainEqual([d1, 2]) // alpha + early（凌晨 3 点算前一天）
    expect(browseVocab({ ...base, items: [...items, early], scope: 'all', days: new Set([d1]) }).items.map((it) => it.lemma)).toEqual([
      'alpha',
      'early',
    ])
    expect(browseVocab({ ...base, items: [...items, early], scope: 'all', days: new Set([d2]) }).items.map((it) => it.lemma)).toEqual([
      'beta',
    ])
    // 多选：两天并起来
    expect(
      browseVocab({ ...base, items: [...items, early], scope: 'all', days: new Set([d1, d2]) }).items.map((it) => it.lemma),
    ).toEqual(['alpha', 'beta', 'early'])
    expect(out.items).toHaveLength(5)
  })

  it('scopeCount 是范围 + 含已掌握后的总数，不受类型/搜索/日期影响', () => {
    const out = browseVocab({ ...base, scope: 'all', query: 'zzz', kind: 'word', days: new Set(['2020-01-01']) })
    expect(out.items).toEqual([])
    expect(out.scopeCount).toBe(4)
  })
})

describe('browseVocab：复习状态', () => {
  const now = new Date(at(2026, 10, 5))
  const dueItem = vocabItem({
    id: 'v-due',
    word: 'dueword',
    lemma: 'dueword',
    createdAt: at(2026, 10, 1),
    reviewState: { ...defaultReviewState(), due: at(2026, 10, 4) },
  })
  const lapsedItem = vocabItem({
    id: 'v-lapse',
    word: 'lapsed',
    lemma: 'lapsed',
    createdAt: at(2026, 10, 1),
    reviewState: { ...defaultReviewState(), lapses: 2 },
  })
  const all = [...items, dueItem, lapsedItem]

  it('待复习：只留 due 已到（受 now 控制）', () => {
    expect(
      browseVocab({ ...base, items: all, scope: 'all', status: 'due', includeMastered: true, now }).items.map(
        (it) => it.lemma,
      ),
    ).toEqual(['dueword'])
    expect(
      browseVocab({ ...base, items: all, scope: 'all', status: 'due', includeMastered: true, now: new Date(at(2026, 10, 3)) })
        .items,
    ).toEqual([])
  })

  it('新词：用 isFresh（没排期、没重学），不是只看 repetitions', () => {
    expect(
      browseVocab({ ...base, items: all, scope: 'all', status: 'fresh', includeMastered: true, now }).items.map(
        (it) => it.lemma,
      ),
    ).toEqual(['alpha', 'beta', 'take off', 'gamma', 'lapsed'])
  })

  it('错过：lapses > 0；已掌握：只看 mastered（不受 includeMastered 影响）', () => {
    expect(
      browseVocab({ ...base, items: all, scope: 'all', status: 'lapsed', includeMastered: true, now }).items.map(
        (it) => it.lemma,
      ),
    ).toEqual(['lapsed'])
    expect(
      browseVocab({ ...base, items: all, scope: 'all', status: 'mastered', now }).items.map((it) => it.lemma),
    ).toEqual(['done'])
  })

  it('状态筛选和选篇计数同口径', () => {
    const out = browseVocab({
      ...base,
      items: all,
      articleEntries: [...entries, entry('a-key', 'lapsed')],
      scope: 'picked',
      pickedArticleIds: new Set(['saved:A']),
      status: 'lapsed',
      includeMastered: true,
      now,
    })
    expect(out.articleCounts.get('saved:A')).toBe(1)
  })
})

describe('browseA4Rows：选篇打印', () => {
  const picked = new Set(['saved:A', 'saved:B'])

  it('按篇出行（同一词可跨篇重复），编号按篇内顺序，释义用该篇语境', () => {
    const rows = browseA4Rows({ ...base, scope: 'picked', pickedArticleIds: picked })
    expect(rows.map((r) => [r.articleTitle, r.item.lemma, r.number])).toEqual([
      ['A 篇', 'alpha', 1],
      ['A 篇', 'take off', null],
      ['A 篇', 'gamma', 2],
      ['B 篇', 'beta', 1],
    ])
    expect(rows[0].articleId).toBe('a-key')
  })

  it('跟浏览页的类型 / 搜索筛选一致', () => {
    const lang = browseA4Rows({ ...base, scope: 'picked', pickedArticleIds: picked, kind: 'lang' })
    expect(lang.map((r) => r.item.lemma)).toEqual(['take off'])
    const found = browseA4Rows({ ...base, scope: 'picked', pickedArticleIds: picked, query: '贝塔' })
    expect(found.map((r) => r.item.lemma)).toEqual(['beta'])
  })

  it('同一词在两篇各一行，各算各的编号', () => {
    const rows = browseA4Rows({
      ...base,
      scope: 'picked',
      pickedArticleIds: new Set(['saved:A', 'saved:C']),
    })
    expect(rows.filter((r) => r.item.lemma === 'gamma').map((r) => [r.articleTitle, r.number])).toEqual([
      ['A 篇', 2],
      ['C 篇', 1],
    ])
  })

  it('本篇 / 全部范围不出行；没选篇也不出', () => {
    expect(browseA4Rows({ ...base, scope: 'all' })).toEqual([])
    expect(browseA4Rows({ ...base, scope: 'article' })).toEqual([])
    expect(browseA4Rows({ ...base, scope: 'picked', pickedArticleIds: new Set() })).toEqual([])
  })
})
