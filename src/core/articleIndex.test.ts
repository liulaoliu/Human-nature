import { describe, expect, it } from 'vitest'
import { buildArticleIndex, EMPTY_ARTICLE_INDEX } from './articleIndex'
import type { ArticleBook } from './matchArticle'
import type { SavedArticle } from './ports'

const book = (entries: Record<string, string>): ArticleBook =>
  Object.fromEntries(
    Object.entries(entries).map(([k, title]) => [k, { title, words: 100, text: 'x' }]),
  )

const saved = (id: string, title: string) => ({ id, title }) as unknown as SavedArticle

describe('buildArticleIndex：文章标识 ↔ slug', () => {
  it('内置文章用标题算 slug，能双向查', () => {
    const idx = buildArticleIndex(book({ '005 Leaders - Post-truth politics': '005 Leaders - Post-truth politics' }), [])
    expect(idx.slugOf('b:005 Leaders - Post-truth politics')).toBe('005-leaders-post-truth-politics')
    expect(idx.refOf('005-leaders-post-truth-politics')).toBe('b:005 Leaders - Post-truth politics')
  })

  it('已保存文章也用标题', () => {
    const idx = buildArticleIndex(null, [saved('saved:1', 'My Reading Notes')])
    expect(idx.slugOf('s:saved:1')).toBe('my-reading-notes')
    expect(idx.refOf('my-reading-notes')).toBe('s:saved:1')
  })

  it('标题撞车时双方都加哈希（不是先到先得，删一篇不会让另一篇的 URL 变）', () => {
    const idx = buildArticleIndex(null, [saved('a', 'Same Title'), saved('b', 'Same Title')])
    const sa = idx.slugOf('s:a')
    const sb = idx.slugOf('s:b')
    expect(sa).not.toBe(sb)
    expect(sa.startsWith('same-title-')).toBe(true)
    expect(sb.startsWith('same-title-')).toBe(true)
    expect(idx.refOf(sa)).toBe('s:a')
    expect(idx.refOf(sb)).toBe('s:b')
  })

  it('中文标题算不出 slug → article-<hash>，仍然唯一可反查', () => {
    const idx = buildArticleIndex(null, [saved('1', '中文标题'), saved('2', '另一篇中文')])
    expect(idx.slugOf('s:1')).toMatch(/^article-[a-z0-9]{4}$/)
    expect(idx.slugOf('s:2')).toMatch(/^article-[a-z0-9]{4}$/)
    expect(idx.slugOf('s:1')).not.toBe(idx.slugOf('s:2'))
    expect(idx.refOf(idx.slugOf('s:1'))).toBe('s:1')
  })

  it('同一组数据顺序不同，映射也相同（URL 不会因为加载顺序变）', () => {
    const a = buildArticleIndex(book({ b: 'B article', a: 'A article' }), [saved('2', 'Two'), saved('1', 'One')])
    const b = buildArticleIndex(book({ a: 'A article', b: 'B article' }), [saved('1', 'One'), saved('2', 'Two')])
    for (const ref of ['b:a', 'b:b', 's:1', 's:2']) {
      expect(a.slugOf(ref)).toBe(b.slugOf(ref))
    }
  })

  it('查不到的标识/ slug 返回空串（别抛、别瞎猜）', () => {
    const idx = buildArticleIndex(book({ x: 'X' }), [])
    expect(idx.slugOf('b:不存在')).toBe('')
    expect(idx.refOf('不存在')).toBe('')
  })

  it('空目录返回空索引', () => {
    expect(buildArticleIndex(null, [])).toBe(EMPTY_ARTICLE_INDEX)
    expect(buildArticleIndex({}, [])).toBe(EMPTY_ARTICLE_INDEX)
  })
})
