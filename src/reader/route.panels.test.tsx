// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'
import { MemoryRouter, useLocation, useNavigate, useNavigationType } from 'react-router-dom'
import type { ReactNode } from 'react'
import { parseReaderRoute, productionPanelPath, useRoutedPanels } from './route'
import { useReaderPanels } from './hooks/useReaderPanels'

/**
 * 布尔面板 ↔ URL 的真实接线（不是假 navigate spy）。
 *
 * 这里用 MemoryRouter + 一个从 `useLocation` 反推 route 的 harness，
 * 等价于 ReaderApp 里「地址栏是事实来源」的用法。断言 pathname 和导航类型：
 * 打开必须是 PUSH，页面内关闭必须是 REPLACE（否则返回键会经过已经关掉的界面）。
 */
function useHarness() {
  const location = useLocation()
  const navigationType = useNavigationType()
  const route = parseReaderRoute(location.pathname)
  const raw = useReaderPanels()
  const panels = useRoutedPanels(raw, route, route.slug)
  return { panels, pathname: location.pathname, navigationType }
}

function setup(initialPath: string) {
  const wrapper = ({ children }: { children: ReactNode }) => (
    <MemoryRouter initialEntries={[initialPath]}>{children}</MemoryRouter>
  )
  return renderHook(() => useHarness(), { wrapper })
}

/** 额外塞一个每次都变的字段，模拟 ReaderApp 里非面板状态的重渲染。 */
function useHarnessWithExtra(extra: number) {
  const location = useLocation()
  const route = parseReaderRoute(location.pathname)
  const raw = useReaderPanels()
  return useRoutedPanels({ ...raw, extra }, route, route.slug)
}

describe('useRoutedPanels：真实导航语义', () => {
  it('打开面板 push 一层，关闭用 replace 回文章', async () => {
    const { result } = setup('/reader/a/my-article')
    act(() => result.current.panels.setIntensiveOpen(true))
    await waitFor(() => expect(result.current.pathname).toBe('/reader/a/my-article/p/intensive'))
    expect(result.current.panels.intensiveOpen).toBe(true)

    act(() => result.current.panels.setIntensiveOpen(false))
    await waitFor(() => expect(result.current.pathname).toBe('/reader/a/my-article'))
    expect(result.current.navigationType).toBe('REPLACE')
    expect(result.current.panels.intensiveOpen).toBe(false)
  })

  it('本篇生词：打开 push、关闭 replace，和别的面板同一套语义', async () => {
    const { result } = setup('/reader/a/my-article')
    act(() => result.current.panels.setBrowseArticle(true))
    await waitFor(() =>
      expect(result.current.pathname).toBe('/reader/a/my-article/p/browse-article'),
    )
    expect(result.current.panels.browseArticle).toBe(true)
    expect(result.current.panels.browseAll).toBe(false)

    act(() => result.current.panels.setBrowseArticle(false))
    await waitFor(() => expect(result.current.pathname).toBe('/reader/a/my-article'))
    expect(result.current.navigationType).toBe('REPLACE')
    expect(result.current.panels.browseArticle).toBe(false)
  })

  it('函数式更新按路由当前状态求值：setStatsOpen(v => !v) 能开也能关', async () => {
    const { result } = setup('/reader')
    act(() => result.current.panels.setStatsOpen((v) => !v))
    await waitFor(() => expect(result.current.pathname).toBe('/reader/p/stats'))
    expect(result.current.panels.statsOpen).toBe(true)

    act(() => result.current.panels.setStatsOpen((v) => !v))
    await waitFor(() => expect(result.current.pathname).toBe('/reader'))
    expect(result.current.navigationType).toBe('REPLACE')
    expect(result.current.panels.statsOpen).toBe(false)
  })

  it('面板已经开着时重复设 true 不再堆历史', async () => {
    const { result } = setup('/reader/a/my-article/p/plan')
    await waitFor(() => expect(result.current.panels.planOpen).toBe(true))
    const before = result.current.navigationType
    act(() => result.current.panels.setPlanOpen(true))
    expect(result.current.pathname).toBe('/reader/a/my-article/p/plan')
    expect(result.current.navigationType).toBe(before)
  })

  it('语言点盖在速读上时（/p/speed/lang），底下的速读不被关掉', async () => {
    const { result } = setup('/reader/a/my-article/p/speed/lang')
    await waitFor(() => expect(result.current.panels.speedReadOpen).toBe(true))
  })

  it('非面板状态重渲染不会重建 setter（否则下游 memo 全部失效）', () => {
    const wrapper = ({ children }: { children: ReactNode }) => (
      <MemoryRouter initialEntries={['/reader/a/my-article']}>{children}</MemoryRouter>
    )
    const { result, rerender } = renderHook(({ extra }: { extra: number }) => useHarnessWithExtra(extra), {
      wrapper,
      initialProps: { extra: 0 },
    })
    const before = result.current.setStatsOpen
    rerender({ extra: 1 })
    expect(result.current.setStatsOpen).toBe(before)
  })
})

/**
 * 奶牛工棚的子视图 / 历史筛选：主面板和历史子视图是同一个地址的两半，
 * 写入方只有 `route.ts` 一份（2026-11-06 复审：两个面板各自 `useSearchParams` 会互相覆盖）。
 */
function useProductionHarness() {
  const location = useLocation()
  const navigate = useNavigate()
  const navigationType = useNavigationType()
  const route = parseReaderRoute(location.pathname, location.search)
  const onNavigate = (
    state: Parameters<typeof productionPanelPath>[1],
    opts?: { replace?: boolean },
  ) => navigate(productionPanelPath(route.slug, state), { replace: opts?.replace })
  return { route, onNavigate, search: location.search, navigationType }
}

function setupProduction(initialPath: string) {
  const wrapper = ({ children }: { children: ReactNode }) => (
    <MemoryRouter initialEntries={[initialPath]}>{children}</MemoryRouter>
  )
  return renderHook(() => useProductionHarness(), { wrapper })
}

describe('production 子视图：真实导航语义', () => {
  it('开历史 push 一层且保留已选筛选；关闭 replace 回工棚、筛选不丢', async () => {
    const { result } = setupProduction('/reader/a/my-article/p/production?pm=skim')
    await waitFor(() => expect(result.current.route.panel).toBe('production'))
    expect(result.current.route.production).toEqual({ mode: 'skim' })

    act(() => result.current.onNavigate({ ...result.current.route.production, view: 'history' }))
    await waitFor(() => expect(result.current.search).toBe('?ph=1&pm=skim'))
    expect(result.current.navigationType).toBe('PUSH')
    expect(result.current.route.production).toEqual({ view: 'history', mode: 'skim' })

    act(() => result.current.onNavigate({ ...result.current.route.production, view: undefined }, { replace: true }))
    await waitFor(() => expect(result.current.search).toBe('?pm=skim'))
    expect(result.current.navigationType).toBe('REPLACE')
    expect(result.current.route.production).toEqual({ mode: 'skim' })
  })

  it('历史里改筛选（replace）不会把 ph 挤掉', async () => {
    const { result } = setupProduction('/reader/a/my-article/p/production?ph=1&pa=all')
    await waitFor(() => expect(result.current.route.production).toEqual({ view: 'history', scope: 'all' }))

    act(() => result.current.onNavigate({ ...result.current.route.production, mode: 'yogurt' }, { replace: true }))
    await waitFor(() => expect(result.current.search).toBe('?ph=1&pm=yogurt&pa=all'))
    expect(result.current.navigationType).toBe('REPLACE')
    expect(result.current.route.production).toEqual({ view: 'history', mode: 'yogurt', scope: 'all' })
  })
})
