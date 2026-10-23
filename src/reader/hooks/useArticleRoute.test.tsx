// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router-dom'
import type { ReactNode } from 'react'
import { useArticleRoute, type UseArticleRouteParams } from './useArticleRoute'

/**
 * URL ↔ 文章 的同步。
 *
 * 这里只测「谁在什么时候调了谁」：真正去读文章 / 清空文章的副作用属于 ReaderApp，
 * 用 spy 代替。URL 断言靠一个读 `useLocation` 的探针组件。
 *
 * slug ↔ 标识 的映射用一张假表（真表在 `core/articleIndex`，另有单测）。
 */
const INDEX = {
  slugOf: (ref: string) =>
    ref === 'b:005 Leaders' ? '005-leaders-post-truth-politics' : ref === 's:saved:1' ? 'my-article' : '',
  refOf: (slug: string) =>
    slug === '005-leaders-post-truth-politics'
      ? 'b:005 Leaders'
      : slug === 'my-article'
        ? 's:saved:1'
        : '',
}

function setup(initialPath: string, initial: UseArticleRouteParams) {
  const seen: { pathname: string } = { pathname: initialPath }
  function Probe() {
    const loc = useLocation()
    seen.pathname = loc.pathname
    return null
  }
  const wrapper = ({ children }: { children: ReactNode }) => (
    <MemoryRouter initialEntries={[initialPath]}>
      <Probe />
      {children}
    </MemoryRouter>
  )
  const hook = renderHook((p: UseArticleRouteParams) => useArticleRoute(p), {
    wrapper,
    initialProps: initial,
  })
  return { ...hook, seen }
}

const params = (over: Partial<UseArticleRouteParams> = {}): UseArticleRouteParams => ({
  routeSlug: '',
  routePanel: '',
  currentRef: '',
  slugOf: INDEX.slugOf,
  refOf: INDEX.refOf,
  indexReady: true,
  hasDoc: false,
  onPick: vi.fn(),
  onClear: vi.fn(),
  ...over,
})

describe('useArticleRoute：首屏恢复补 URL', () => {
  it('用 slug 补地址栏（不是 b%3A 那种编码标识）', async () => {
    const p = params({ hasDoc: true, currentRef: 'b:005 Leaders' })
    const { seen } = setup('/', p)
    await waitFor(() => expect(seen.pathname).toBe('/reader/a/005-leaders-post-truth-politics'))
  })

  it('用 slug 补地址栏时保留已经打开的面板', async () => {
    const p = params({ hasDoc: true, currentRef: 'b:005 Leaders', routePanel: 'intensive' })
    const { seen } = setup('/', p)
    await waitFor(() =>
      expect(seen.pathname).toBe('/reader/a/005-leaders-post-truth-politics/p/intensive'),
    )
  })

  it('索引里还没有这篇（slug 为空）时不动 URL', async () => {
    const { seen } = setup('/', params({ hasDoc: true, currentRef: 'b:不在索引里' }))
    await Promise.resolve()
    expect(seen.pathname).toBe('/')
  })
})

describe('useArticleRoute：URL → 文章', () => {
  it('按 URL 里的 slug 找到文章并加载', async () => {
    const onPick = vi.fn()
    setup('/reader/a/005-leaders-post-truth-politics', params({ routeSlug: '005-leaders-post-truth-politics', onPick }))
    await waitFor(() => expect(onPick).toHaveBeenCalledWith('b:005 Leaders'))
  })

  it('索引没就绪时先不加载（等目录/已保存列表到齐）', async () => {
    const onPick = vi.fn()
    const p = params({ routeSlug: '005-leaders-post-truth-politics', indexReady: false, onPick })
    const { rerender } = setup('/reader/a/005-leaders-post-truth-politics', p)
    await Promise.resolve()
    expect(onPick).not.toHaveBeenCalled()
    // 就绪后再补上
    rerender({ ...p, indexReady: true })
    await waitFor(() => expect(onPick).toHaveBeenCalledWith('b:005 Leaders'))
  })

  it('认不出的 slug 不乱开文章（链接过期就停在列表）', async () => {
    const onPick = vi.fn()
    setup('/reader/a/deleted-article', params({ routeSlug: 'deleted-article', onPick }))
    await Promise.resolve()
    expect(onPick).not.toHaveBeenCalled()
  })

  it('已经打开的就是这一篇时不重复加载', async () => {
    const onPick = vi.fn()
    setup(
      '/reader/a/005-leaders-post-truth-politics',
      params({
        routeSlug: '005-leaders-post-truth-politics',
        currentRef: 'b:005 Leaders',
        hasDoc: true,
        onPick,
      }),
    )
    await Promise.resolve()
    expect(onPick).not.toHaveBeenCalled()
  })

  it('点选择器只导航（URL 用 slug），加载交给 URL effect', async () => {
    const onPick = vi.fn()
    const { result, seen } = setup('/', params({ onPick }))
    act(() => result.current('s:saved:1'))
    await waitFor(() => expect(seen.pathname).toBe('/reader/a/my-article'))
    expect(onPick).not.toHaveBeenCalled()
  })

  it('索引还没建好时点选择器直接加载 —— 不能「点了没反应」', async () => {
    const onPick = vi.fn()
    // slugOf 一律返回空（等价于 articles.json 还没到）
    const empty = { slugOf: () => '', refOf: () => '' }
    const { result, seen } = setup('/', params({ ...empty, onPick }))
    act(() => result.current('b:005 Leaders'))
    expect(onPick).toHaveBeenCalledWith('b:005 Leaders')
    // URL 留空，等索引到齐后由 ① 补
    expect(seen.pathname).toBe('/')
  })

  it('索引晚到时会补上 URL（先加载、后补地址）', async () => {
    const onPick = vi.fn()
    const p = params({ hasDoc: true, currentRef: 'b:005 Leaders', ...{ slugOf: () => '' }, onPick })
    const { rerender, seen } = setup('/', p)
    await Promise.resolve()
    expect(seen.pathname).toBe('/')
    // 目录到齐，slugOf 恢复
    rerender(params({ hasDoc: true, currentRef: 'b:005 Leaders', onPick }))
    await waitFor(() => expect(seen.pathname).toBe('/reader/a/005-leaders-post-truth-politics'))
  })
})

describe('useArticleRoute：回到列表', () => {
  it('URL 里没文章、当前有文章、且同步过一次 → 关掉文章', async () => {
    const onClear = vi.fn()
    const { rerender } = setup(
      '/reader/a/005-leaders-post-truth-politics',
      params({
        routeSlug: '005-leaders-post-truth-politics',
        currentRef: 'b:005 Leaders',
        hasDoc: true,
        onClear,
      }),
    )
    await Promise.resolve()
    rerender(
      params({ routeSlug: '', currentRef: 'b:005 Leaders', hasDoc: true, onClear }),
    )
    await waitFor(() => expect(onClear).toHaveBeenCalled())
  })

  it('无文章也能开的面板（/reader/p/plan）不会把已打开的文章清掉', async () => {
    const onClear = vi.fn()
    setup(
      '/reader/p/plan',
      params({ routePanel: 'plan', currentRef: 'b:005 Leaders', hasDoc: true, onClear }),
    )
    await Promise.resolve()
    expect(onClear).not.toHaveBeenCalled()
  })

  it('一次都没同步过时不会误清（首屏刚打开、URL 还没补上）', async () => {
    const onClear = vi.fn()
    const { rerender } = setup('/', params({ onClear }))
    rerender(params({ hasDoc: false, onClear }))
    await Promise.resolve()
    expect(onClear).not.toHaveBeenCalled()
  })
})
