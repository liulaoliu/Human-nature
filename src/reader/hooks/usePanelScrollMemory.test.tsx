// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest'
import { renderHook } from '@testing-library/react'
import {
  clearPanelScrollMemory,
  readPanelScrollMemory,
  usePanelScrollMemory,
} from './usePanelScrollMemory'

/**
 * 精读面板的滚动位置记忆：只验证「卸载保存 / 挂载恢复 / 换文章各记各的」。
 * 不测 localStorage：这套按设计只存内存，刷新不该恢复。
 */
beforeEach(() => {
  clearPanelScrollMemory()
})

function setup(key = 'article-a') {
  const el = document.createElement('div')
  const ref = { current: el }
  const hook = renderHook(({ k }) => usePanelScrollMemory(ref, k), {
    initialProps: { k: key },
  })
  return { el, ...hook }
}

describe('usePanelScrollMemory', () => {
  it('卸载时保存，重新挂载时恢复', () => {
    const first = setup()
    first.el.scrollTop = 120
    first.unmount()
    expect(readPanelScrollMemory('article-a')).toBe(120)

    const second = setup()
    expect(second.el.scrollTop).toBe(120)
  })

  it('换文章各记各的：旧键保存、新键恢复', () => {
    const first = setup('article-a')
    first.el.scrollTop = 80
    first.rerender({ k: 'article-b' })
    expect(readPanelScrollMemory('article-a')).toBe(80)

    first.el.scrollTop = 240
    first.rerender({ k: 'article-a' })
    expect(first.el.scrollTop).toBe(80)

    first.rerender({ k: 'article-b' })
    expect(first.el.scrollTop).toBe(240)
  })

  it('滚回顶部就删掉记录，不占内存', () => {
    const first = setup()
    first.el.scrollTop = 90
    first.unmount()
    expect(readPanelScrollMemory('article-a')).toBe(90)

    const second = setup()
    second.el.scrollTop = 0
    second.unmount()
    expect(readPanelScrollMemory('article-a')).toBeUndefined()
  })

  it('最多记 20 篇，最久没用的先淘汰', () => {
    const { el, rerender, unmount } = setup('article-0')
    for (let i = 0; i < 21; i++) {
      el.scrollTop = i + 1
      rerender({ k: `article-${i + 1}` })
    }
    unmount()

    expect(readPanelScrollMemory('article-0')).toBeUndefined()
    expect(readPanelScrollMemory('article-21')).toBe(21)
  })

  it('没有文章键时什么都不做', () => {
    const { el, unmount } = setup('')
    el.scrollTop = 50
    unmount()
    expect(readPanelScrollMemory('')).toBeUndefined()
  })
})
