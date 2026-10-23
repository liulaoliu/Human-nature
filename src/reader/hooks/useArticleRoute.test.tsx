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
 */
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
  routeRef: '',
  currentRef: '',
  hasDoc: false,
  onPick: vi.fn(),
  onClear: vi.fn(),
  ...over,
})

describe('useArticleRoute：首屏恢复补 URL', () => {
  it('恢复出文章时把 URL 补成 /a/<ref>（replace，不堆历史）', async () => {
    const p = params({ hasDoc: true, currentRef: 'b:005 Leaders' })
    const { seen } = setup('/', p)
    await waitFor(() => expect(seen.pathname).toBe('/a/b%3A005%20Leaders'))
  })

  it('没有文章时不动 URL', async () => {
    const { seen } = setup('/', params())
    await Promise.resolve()
    expect(seen.pathname).toBe('/')
  })
})

describe('useArticleRoute：URL → 文章', () => {
  it('URL 指向另一篇就加载它，同一篇不重复加载', async () => {
    const onPick = vi.fn()
    const { rerender } = setup('/a/b%3Ax', params({ routeRef: 'b:x', currentRef: '', onPick }))
    await waitFor(() => expect(onPick).toHaveBeenCalledWith('b:x'))
    onPick.mockClear()
    // 已经加载好了（currentRef 跟上），再渲染不该重复加载
    rerender(params({ routeRef: 'b:x', currentRef: 'b:x', hasDoc: true, onPick }))
    await Promise.resolve()
    expect(onPick).not.toHaveBeenCalled()
  })

  it('点选择器只导航，不直接加载（加载由 URL effect 负责）', async () => {
    const onPick = vi.fn()
    const { result, seen } = setup('/', params({ onPick }))
    act(() => result.current('b:y'))
    await waitFor(() => expect(seen.pathname).toBe('/a/b%3Ay'))
    expect(onPick).not.toHaveBeenCalled()
  })
})

describe('useArticleRoute：回到列表', () => {
  it('URL 里没文章、当前有文章、且同步过一次 → 关掉文章', async () => {
    const onClear = vi.fn()
    const { rerender } = setup(
      '/a/b%3Ax',
      params({ routeRef: 'b:x', currentRef: 'b:x', hasDoc: true, onClear }),
    )
    await Promise.resolve()
    // 用户按返回：URL 回到 /，routeRef 变空
    rerender(params({ routeRef: '', currentRef: 'b:x', hasDoc: true, onClear }))
    await waitFor(() => expect(onClear).toHaveBeenCalled())
  })

  it('一次都没同步过时不会误清（首屏刚打开、URL 还没补上）', async () => {
    const onClear = vi.fn()
    const { rerender } = setup('/', params({ onClear }))
    rerender(params({ hasDoc: false, onClear }))
    await Promise.resolve()
    expect(onClear).not.toHaveBeenCalled()
  })
})
