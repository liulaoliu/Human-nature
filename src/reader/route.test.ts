import { describe, expect, it } from 'vitest'
import { articlePath, openPanelName, panelFlags, panelPath, parseReaderRoute } from './route'

/**
 * 路由字符串 ↔ 状态 的往返。
 * 这里只测纯函数：`useRoutedPanels` 的接线由 ReaderApp 集成测试兜。
 */
describe('route：文章路径', () => {
  it('没文章时是 /，有文章时是 /a/<ref>（ref 要转义）', () => {
    expect(articlePath('')).toBe('/')
    expect(articlePath('b:005 Leaders')).toBe('/a/b%3A005%20Leaders')
    expect(parseReaderRoute('/a/b%3A005%20Leaders')).toEqual({ ref: 'b:005 Leaders', panel: '' })
  })

  it('面板挂在文章下；没文章时挂在根下', () => {
    expect(panelPath('b:x', 'intensive')).toBe('/a/b%3Ax/p/intensive')
    expect(panelPath('', 'plan')).toBe('/p/plan')
    expect(parseReaderRoute('/a/b%3Ax/p/intensive')).toEqual({ ref: 'b:x', panel: 'intensive' })
    expect(parseReaderRoute('/p/plan')).toEqual({ ref: '', panel: 'plan' })
  })

  it('不认识的面板名当没有，不会把页面搞崩', () => {
    expect(parseReaderRoute('/a/b%3Ax/p/nope')).toEqual({ ref: 'b:x', panel: '' })
    expect(parseReaderRoute('/wat')).toEqual({ ref: '', panel: '' })
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
