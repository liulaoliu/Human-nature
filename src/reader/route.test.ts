import { describe, expect, it } from 'vitest'
import { articlePath, isFlowName, panelFlags, panelPath, parseReaderRoute } from './route'

/**
 * 路由字符串 ↔ 状态 的往返。
 * 这里只测纯函数：`useRoutedPanels` 的接线由 ReaderApp 集成测试兜，
 * `useArticleRoute` 有自己的单测。
 *
 * 路径段是 **slug**（`005-leaders-post-truth-politics`），不是内部标识 `b:005 Leaders` ——
 * 所以正常路径里不该出现 `%3A` / `%20`。
 */
describe('route：文章路径', () => {
  it('单入口下所有路径都带 /reader 前缀', () => {
    expect(articlePath('')).toBe('/reader')
    expect(articlePath('005-leaders-post-truth-politics')).toBe('/reader/a/005-leaders-post-truth-politics')
    expect(parseReaderRoute('/reader/a/005-leaders-post-truth-politics')).toEqual({
      slug: '005-leaders-post-truth-politics',
      panel: '',
    })
  })

  it('不带前缀的老路径也能解析（单测 / 旧调用兼容）', () => {
    expect(parseReaderRoute('/a/005-leaders')).toEqual({ slug: '005-leaders', panel: '' })
    expect(parseReaderRoute('/reader')).toEqual({ slug: '', panel: '' })
    expect(parseReaderRoute('/reader/')).toEqual({ slug: '', panel: '' })
  })

  it('手敲的 URL 里若有转义字符也能解回来，坏转义不崩', () => {
    expect(parseReaderRoute('/reader/a/%E4%B8%AD%E6%96%87').slug).toBe('中文')
    expect(parseReaderRoute('/a/%E4%B8').slug).toBe('%E4%B8')
  })

  it('面板挂在文章下；没文章时挂在根下', () => {
    expect(panelPath('005-leaders', 'intensive')).toBe('/reader/a/005-leaders/p/intensive')
    expect(panelPath('', 'plan')).toBe('/reader/p/plan')
    expect(parseReaderRoute('/reader/a/005-leaders/p/intensive')).toEqual({
      slug: '005-leaders',
      panel: 'intensive',
    })
    expect(parseReaderRoute('/p/plan')).toEqual({ slug: '', panel: 'plan' })
  })

  it('整页会话也算面板（背单词 / 考试 / 速读 / 听写 / 听力 / 仿写 / 语言点 / 新建）', () => {
    for (const name of ['study', 'quiz', 'quick', 'dict', 'listen', 'write', 'lang', 'compose'] as const) {
      expect(panelPath('005-leaders', name)).toBe(`/reader/a/005-leaders/p/${name}`)
      expect(parseReaderRoute(`/reader/p/${name}`)).toEqual({ slug: '', panel: name })
      expect(isFlowName(name)).toBe(true)
    }
    expect(isFlowName('plan')).toBe(false)
  })

  it('不认识的面板名当没有，不会把页面搞崩', () => {
    expect(parseReaderRoute('/reader/a/005-leaders/p/nope')).toEqual({ slug: '005-leaders', panel: '' })
    expect(parseReaderRoute('/wat')).toEqual({ slug: '', panel: '' })
    expect(parseReaderRoute('/')).toEqual({ slug: '', panel: '' })
  })
})

describe('route：面板标志', () => {
  it('flags 一次只开一个', () => {
    const f = panelFlags('stats')
    expect(f.stats).toBe(true)
    expect(f.intensive).toBe(false)
    expect(panelFlags('').stats).toBe(false)
  })
})
