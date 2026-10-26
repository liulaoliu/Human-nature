// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'
import { MemoryRouter, useLocation, useNavigationType } from 'react-router-dom'
import type { ReactNode } from 'react'
import { useBrowseFilters } from './useBrowseFilters'

/** 筛选 ↔ URL 的真实接线：读 query、只 replace、不换 pathname。 */
function useHarness(fallback: 'all' | 'article') {
  const handle = useBrowseFilters(fallback)
  const location = useLocation()
  const navigationType = useNavigationType()
  return { ...handle, location, navigationType }
}

function setup(path: string, fallback: 'all' | 'article' = 'all') {
  const wrapper = ({ children }: { children: ReactNode }) => (
    <MemoryRouter initialEntries={[path]}>{children}</MemoryRouter>
  )
  return renderHook(() => useHarness(fallback), { wrapper })
}

describe('useBrowseFilters', () => {
  it('从 URL 读筛选；默认值按入口范围补', () => {
    const { result } = setup('/reader/p/browse?kind=word&q=run')
    expect(result.current.filters.kind).toBe('word')
    expect(result.current.filters.query).toBe('run')
    expect(result.current.filters.scope).toBe('all')
    expect(result.current.filters.includeMastered).toBe(true)
  })

  it('改筛选：只改 query、replace，不动 pathname', async () => {
    const { result } = setup('/reader/a/my-article/p/browse')
    act(() => result.current.setFilters({ ...result.current.filters, status: 'due' }))
    await waitFor(() => expect(result.current.location.search).toContain('status=due'))
    expect(result.current.location.pathname).toBe('/reader/a/my-article/p/browse')
    expect(result.current.navigationType).toBe('REPLACE')
    expect(result.current.filters.status).toBe('due')
  })

  it('入口默认 scope 不写地址；从本篇入口切到全部才写 scope=all', async () => {
    const { result } = setup('/reader/a/my-article/p/browse-article', 'article')
    expect(result.current.filters.scope).toBe('article')
    act(() => result.current.setFilters({ ...result.current.filters, scope: 'all' }))
    await waitFor(() => expect(result.current.location.search).toContain('scope=all'))
  })

  it('序列化后和当前 query 相同：不导航（反复点不会堆 history）', async () => {
    const { result } = setup('/reader/p/browse?kind=word')
    act(() => result.current.setFilters({ ...result.current.filters, kind: 'word' }))
    // 没有变化时 navigationType 还是 POP（初始），pathname / search 不变
    expect(result.current.navigationType).toBe('POP')
    expect(result.current.location.search).toBe('?kind=word')
  })
})
