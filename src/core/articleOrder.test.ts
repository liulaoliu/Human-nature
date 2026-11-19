import { describe, expect, it } from 'vitest'
import type { SavedArticle } from './ports'
import { compareSavedArticles, groupSavedArticles, SINGLE_ARTICLE_GROUP } from './articleOrder'

const a = (id: string, over: Partial<SavedArticle> = {}): SavedArticle => ({
  id,
  title: id,
  sourceKey: null,
  text: '',
  paragraphs: [],
  sentences: [],
  updatedAt: '2026-10-20T00:00:00.000Z',
  ...over,
})

describe('groupSavedArticles', () => {
  it('按书分组，组按名字排、「单篇」最后', () => {
    const groups = groupSavedArticles([
      a('loose', { book: undefined }),
      a('z', { book: 'Book Z' }),
      a('a', { book: 'Book A' }),
    ])
    expect(groups.map(([name]) => name)).toEqual(['Book A', 'Book Z', SINGLE_ARTICLE_GROUP])
  })

  it('组内按建立时间从旧到新：读 / 改过（updatedAt 变了）也不换位置', () => {
    const groups = groupSavedArticles([
      a('ch2', { book: 'Book', createdAt: '2026-10-02T00:00:00.000Z', updatedAt: '2026-11-19T00:00:00.000Z' }),
      a('ch1', { book: 'Book', createdAt: '2026-10-01T00:00:00.000Z', updatedAt: '2026-10-01T00:00:00.000Z' }),
    ])
    expect(groups[0]?.[1].map((x) => x.id)).toEqual(['ch1', 'ch2'])
  })

  it('没有 createdAt 时退回 updatedAt；完全相同时按标题稳定排序', () => {
    const groups = groupSavedArticles([
      a('b', { book: 'Book', title: 'Beta' }),
      a('a', { book: 'Book', title: 'Alpha' }),
    ])
    expect(groups[0]?.[1].map((x) => x.id)).toEqual(['a', 'b'])
  })
})

describe('compareSavedArticles', () => {
  it('建立时间优先，时间相同才看标题 / id', () => {
    expect(compareSavedArticles(a('x', { createdAt: '2026-10-01T00:00:00.000Z' }), a('y', { createdAt: '2026-10-02T00:00:00.000Z' }))).toBeLessThan(0)
    expect(compareSavedArticles(a('b', { title: 'B' }), a('a', { title: 'A' }))).toBeGreaterThan(0)
  })
})
