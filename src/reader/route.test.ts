import { describe, expect, it } from 'vitest'
import {
  articlePath,
  goldenPanelPath,
  isFlowName,
  isOverlayFlow,
  panelFlags,
  panelPath,
  parseGoldenQuery,
  parseReaderRoute,
} from './route'

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
      overlay: '',
    })
  })

  it('不带前缀的老路径也能解析（单测 / 旧调用兼容）', () => {
    expect(parseReaderRoute('/a/005-leaders')).toEqual({ slug: '005-leaders', panel: '', overlay: '' })
    expect(parseReaderRoute('/reader')).toEqual({ slug: '', panel: '', overlay: '' })
    expect(parseReaderRoute('/reader/')).toEqual({ slug: '', panel: '', overlay: '' })
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
      overlay: '',
    })
    expect(parseReaderRoute('/p/plan')).toEqual({ slug: '', panel: 'plan', overlay: '' })
  })

  it('整页会话也算面板（背单词 / 考试 / 速读 / 听写 / 听力 / 仿写 / 回译 / 语言点 / 新建）', () => {
    for (const name of ['study', 'quiz', 'quick', 'dict', 'listen', 'write', 'back', 'golden', 'lang', 'compose'] as const) {
      expect(panelPath('005-leaders', name)).toBe(`/reader/a/005-leaders/p/${name}`)
      expect(parseReaderRoute(`/reader/p/${name}`)).toEqual({ slug: '', panel: name, overlay: '' })
      expect(isFlowName(name)).toBe(true)
    }
    expect(isFlowName('plan')).toBe(false)
  })

  it('不认识的面板名当没有，不会把页面搞崩', () => {
    expect(parseReaderRoute('/reader/a/005-leaders/p/nope')).toEqual({
      slug: '005-leaders',
      panel: '',
      overlay: '',
    })
    expect(parseReaderRoute('/wat')).toEqual({ slug: '', panel: '', overlay: '' })
    expect(parseReaderRoute('/')).toEqual({ slug: '', panel: '', overlay: '' })
  })
})

describe('route：浮层叠在面板上（速读里的语言点）', () => {
  it('布尔面板 + 浮层 → /p/<面板>/<浮层>，两段都解析得回来', () => {
    expect(panelPath('005-leaders', 'speed', 'lang')).toBe('/reader/a/005-leaders/p/speed/lang')
    expect(parseReaderRoute('/reader/a/005-leaders/p/speed/lang')).toEqual({
      slug: '005-leaders',
      panel: 'speed',
      overlay: 'lang',
    })
    expect(parseReaderRoute('/p/speed/lang')).toEqual({ slug: '', panel: 'speed', overlay: 'lang' })
  })

  it('只有语言点是浮层；整页会话不往上叠', () => {
    expect(isOverlayFlow('lang')).toBe(true)
    expect(isOverlayFlow('study')).toBe(false)
    expect(isOverlayFlow('speed')).toBe(false)
    expect(isOverlayFlow('')).toBe(false)
    // 会话已经是整页，再叠浮层会变成两个全屏界面抢一个地址 → 忽略
    expect(panelPath('005-leaders', 'study', 'lang')).toBe('/reader/a/005-leaders/p/study')
    expect(parseReaderRoute('/reader/a/005-leaders/p/study/lang')).toEqual({
      slug: '005-leaders',
      panel: 'study',
      overlay: '',
    })
  })

  it('第二段不是浮层就当没有，不会把速读一起关掉', () => {
    expect(parseReaderRoute('/reader/a/005-leaders/p/speed/plan')).toEqual({
      slug: '005-leaders',
      panel: 'speed',
      overlay: '',
    })
    expect(panelPath('005-leaders', 'speed', 'plan')).toBe('/reader/a/005-leaders/p/speed')
  })
})

describe('route：golden 子视图 / 历史详情', () => {
  it('errors / history / recordKey / scope 往返，recordKey 会编码', () => {
    const state = {
      view: 'history' as const,
      recordKey: '2026-10-31T00:00:00.000Z|a1|s1|focus|1|x',
      scope: 'all' as const,
      from: 'errors' as const,
    }
    const path = goldenPanelPath('my-article', state)
    expect(path).toContain('/reader/a/my-article/p/golden?')
    expect(path).toContain('gv=history')
    expect(parseGoldenQuery(path.split('?')[1])).toEqual(state)
    expect(parseReaderRoute('/reader/a/my-article/p/golden', path.split('?')[1])).toMatchObject({
      panel: 'golden',
      golden: state,
    })
  })

  it('只有 golden 面板带 query；坏 gv 当没有，gr 单独保留', () => {
    expect(parseReaderRoute('/reader/p/golden', '?gv=errors')).toMatchObject({
      panel: 'golden',
      golden: { view: 'errors' },
    })
    expect(parseReaderRoute('/reader/p/speed', '?gv=errors')).toEqual({
      slug: '',
      panel: 'speed',
      overlay: '',
    })
    expect(parseGoldenQuery('?gv=nope&gr=x')).toEqual({ recordKey: 'x' })
    expect(parseGoldenQuery('?gv=nope')).toBeUndefined()
  })
})

describe('route：面板标志', () => {
  it('flags 一次只开一个', () => {
    const f = panelFlags('stats')
    expect(f.stats).toBe(true)
    expect(f.intensive).toBe(false)
    expect(panelFlags('').stats).toBe(false)
  })

  it('本篇生词有独立地址：/p/browse-article，只开 browseArticle', () => {
    expect(panelPath('005-leaders', 'browse-article')).toBe('/reader/a/005-leaders/p/browse-article')
    expect(parseReaderRoute('/reader/p/browse-article')).toEqual({
      slug: '',
      panel: 'browse-article',
      overlay: '',
    })
    const f = panelFlags('browse-article')
    expect(f['browse-article']).toBe(true)
    expect(f.browse).toBe(false)
  })
})
