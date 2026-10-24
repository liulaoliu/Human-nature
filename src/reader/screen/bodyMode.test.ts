import { describe, expect, it } from 'vitest'
import { bodyMode, type BodyModeInput } from './bodyMode'

const base: BodyModeInput = {
  composing: false,
  routeSlug: '',
  indexReady: true,
  routeRef: '',
  currentRef: '',
  hasDoc: false,
}

describe('bodyMode：正文槽位', () => {
  it('用户主动新建 → composer，即使当前有正文', () => {
    expect(bodyMode({ ...base, composing: true, routeSlug: 'a', routeRef: 's:1', currentRef: 's:1', hasDoc: true })).toBe(
      'composer',
    )
  })

  it('没有 URL 也没有正文 → 默认首页的 composer', () => {
    expect(bodyMode(base)).toBe('composer')
  })

  it('没有 URL 但已恢复正文 → article', () => {
    expect(bodyMode({ ...base, currentRef: 's:1', hasDoc: true })).toBe('article')
  })

  it('深链接首帧索引没就绪 → loading，不闪 composer', () => {
    expect(bodyMode({ ...base, routeSlug: 'my-article', indexReady: false })).toBe('loading')
  })

  it('索引就绪但查无此篇 → missing', () => {
    expect(bodyMode({ ...base, routeSlug: 'gone', routeRef: '' })).toBe('missing')
  })

  it('URL 指向另一篇、正文还没换过来 → loading', () => {
    expect(
      bodyMode({ ...base, routeSlug: 'next', routeRef: 's:2', currentRef: 's:1', hasDoc: true }),
    ).toBe('loading')
  })

  it('URL 指向当前篇但正文还没加载 → loading', () => {
    expect(bodyMode({ ...base, routeSlug: 'same', routeRef: 's:1', currentRef: 's:1', hasDoc: false })).toBe(
      'loading',
    )
  })

  it('URL、当前篇、正文三者一致 → article', () => {
    expect(
      bodyMode({ ...base, routeSlug: 'same', routeRef: 's:1', currentRef: 's:1', hasDoc: true }),
    ).toBe('article')
  })
})
