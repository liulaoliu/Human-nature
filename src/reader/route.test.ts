import { describe, expect, it } from 'vitest'
import { articlePath, openPanelName, panelFlags, panelPath, parseReaderRoute } from './route'

/**
 * 路由字符串 ↔ 状态 的往返。
 * 这里只测纯函数：`useRoutedPanels` 的接线由 ReaderApp 集成测试兜，
 * `useArticleRoute` 有自己的单测。
 *
 * 路径段是 **slug**（`005-leaders-post-truth-politics`），不是内部标识 `b:005 Leaders` ——
 * 所以正常路径里不该出现 `%3A` / `%20`。
 */
describe('route：文章路径', () => {
  it('没文章是 /，有文章是 /a/<slug>，且不做多余转义', () => {
    expect(articlePath('')).toBe('/')
    expect(articlePath('005-leaders-post-truth-politics')).toBe('/a/005-leaders-post-truth-politics')
    expect(parseReaderRoute('/a/005-leaders-post-truth-politics')).toEqual({
      slug: '005-leaders-post-truth-politics',
      panel: '',
    })
  })

  it('手敲的 URL 里若有转义字符也能解回来，坏转义不崩', () => {
    expect(parseReaderRoute('/a/%E4%B8%AD%E6%96%87').slug).toBe('中文')
    expect(parseReaderRoute('/a/%E4%B8').slug).toBe('%E4%B8')
  })

  it('面板挂在文章下；没文章时挂在根下', () => {
    expect(panelPath('005-leaders', 'intensive')).toBe('/a/005-leaders/p/intensive')
    expect(panelPath('', 'plan')).toBe('/p/plan')
    expect(parseReaderRoute('/a/005-leaders/p/intensive')).toEqual({ slug: '005-leaders', panel: 'intensive' })
    expect(parseReaderRoute('/p/plan')).toEqual({ slug: '', panel: 'plan' })
  })

  it('不认识的面板名当没有，不会把页面搞崩', () => {
    expect(parseReaderRoute('/a/005-leaders/p/nope')).toEqual({ slug: '005-leaders', panel: '' })
    expect(parseReaderRoute('/wat')).toEqual({ slug: '', panel: '' })
    expect(parseReaderRoute('/')).toEqual({ slug: '', panel: '' })
  })
})

describe('route：面板标志', () => {
  const base = {
    intensiveOpen: false,
    speedReadOpen: false,
    planOpen: false,
    journalOpen: false,
    exportOpen: false,
    goalOpen: false,
    statsOpen: false,
    browseAll: false,
  }

  it('哪个开着就报哪个', () => {
    expect(openPanelName({ ...base, planOpen: true })).toBe('plan')
    expect(openPanelName({ ...base, browseAll: true })).toBe('browse')
    expect(openPanelName(base)).toBe('')
  })

  it('flags 一次只开一个（stats 与 statsDetail 都落到统计）', () => {
    const f = panelFlags('stats')
    expect(f.stats).toBe(true)
    expect(f.intensive).toBe(false)
    expect(panelFlags('').stats).toBe(false)
  })
})
