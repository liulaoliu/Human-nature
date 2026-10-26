import { describe, expect, it } from 'vitest'
import {
  browseFilterSearch,
  defaultBrowseFilters,
  defaultIncludeMastered,
  parseBrowseFilters,
} from './browseQuery'

/**
 * 筛选状态 ↔ URL：默认值不写、坏值回落、日期/选篇排序去重、往返稳定。
 */
describe('browseQuery：解析', () => {
  it('空 query：按入口范围给默认值', () => {
    expect(parseBrowseFilters('', 'all')).toEqual(defaultBrowseFilters('all'))
    expect(parseBrowseFilters('', 'article')).toEqual(defaultBrowseFilters('article'))
    expect(defaultIncludeMastered('all')).toBe(true)
    expect(defaultIncludeMastered('article')).toBe(false)
  })

  it('完整参数：scope / kind / q / days / status / mastered / picked', () => {
    const out = parseBrowseFilters(
      '?scope=picked&kind=lang&q=run&days=2026-10-02,2026-10-01&status=due&mastered=1&picked=saved:A&picked=saved:B',
      'all',
    )
    expect(out).toEqual({
      scope: 'picked',
      kind: 'lang',
      query: 'run',
      days: ['2026-10-01', '2026-10-02'],
      status: 'due',
      includeMastered: true,
      picked: ['saved:A', 'saved:B'],
    })
  })

  it('坏值 / 坏日期回落默认，不把页面搞崩', () => {
    const out = parseBrowseFilters('?scope=nope&kind=nope&status=nope&days=nope,2026-10-01', 'article')
    expect(out.scope).toBe('article')
    expect(out.kind).toBe('all')
    expect(out.status).toBe('all')
    expect(out.days).toEqual(['2026-10-01'])
  })

  it('选篇：没有 picked / picked=all = 全选；picked= 空串 = 一个都不选', () => {
    expect(parseBrowseFilters('?scope=picked').picked).toBeUndefined()
    expect(parseBrowseFilters('?scope=picked&picked=all').picked).toBeUndefined()
    expect(parseBrowseFilters('?scope=picked&picked=').picked).toEqual([])
  })
})

describe('browseQuery：序列化', () => {
  it('默认值不写，地址短', () => {
    expect(browseFilterSearch(defaultBrowseFilters('all'), 'all')).toBe('')
    expect(browseFilterSearch(defaultBrowseFilters('article'), 'article')).toBe('')
  })

  it('和入口默认不同的 scope / mastered 才写', () => {
    const f = { ...defaultBrowseFilters('all'), scope: 'article' as const, includeMastered: true }
    expect(browseFilterSearch(f, 'all')).toBe('scope=article&mastered=1')
    const allFromArticle = { ...defaultBrowseFilters('article'), scope: 'all' as const, includeMastered: false }
    expect(browseFilterSearch(allFromArticle, 'article')).toBe('scope=all&mastered=0')
  })

  it('日期 / 选篇排序去重；picked 全选用省略、空选用 picked=', () => {
    const f = {
      ...defaultBrowseFilters('picked'),
      days: ['2026-10-02', '2026-10-01', '2026-10-01'],
      picked: ['saved:B', 'saved:A'],
    }
    const search = browseFilterSearch(f, 'picked')
    expect(search).toContain('days=2026-10-01%2C2026-10-02')
    expect(search).toContain('picked=saved%3AA')
    expect(search).toContain('picked=saved%3AB')
    expect(browseFilterSearch({ ...f, picked: undefined }, 'picked')).not.toContain('picked=')
    expect(browseFilterSearch({ ...f, picked: [] }, 'picked')).toContain('picked=')
  })

  it('往返：解析(序列化(f)) 回来还是同一组筛选', () => {
    const f = {
      scope: 'picked' as const,
      kind: 'word' as const,
      query: 'alpha beta',
      days: ['2026-10-03', '2026-10-01'],
      status: 'lapsed' as const,
      includeMastered: true,
      picked: ['saved:B', 'saved:A'],
    }
    const search = browseFilterSearch(f, 'all')
    expect(parseBrowseFilters(search, 'all')).toEqual({ ...f, days: ['2026-10-01', '2026-10-03'], picked: ['saved:A', 'saved:B'] })
  })
})
