// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import type { ReactNode } from 'react'
import { useReaderArticleRouting, useReaderPanelRouting } from './useReaderRouting'

const wrapper = (initialPath: string) => {
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <MemoryRouter initialEntries={[initialPath]}>{children}</MemoryRouter>
  )
  return Wrapper
}

describe('useReaderPanelRouting', () => {
  it('面板 setter 仍然走真实 URL：打开 push，关闭 replace', async () => {
    const { result } = renderHook(() => useReaderPanelRouting('my-article'), {
      wrapper: wrapper('/reader/a/my-article'),
    })
    act(() => result.current.panels.setStatsOpen(true))
    await waitFor(() => expect(result.current.route.panel).toBe('stats'))
    expect(result.current.route.slug).toBe('my-article')

    act(() => result.current.panels.setStatsOpen(false))
    await waitFor(() => expect(result.current.route.panel).toBe(''))
  })
})

describe('useReaderArticleRouting', () => {
  it('URL 指向另一篇时调 onPick，并给出正文槽位需要的路由事实', async () => {
    const onPick = vi.fn()
    const { result } = renderHook(
      () =>
        useReaderArticleRouting({
          routeSlug: 'my-article',
          routePanel: '',
          currentRef: 'b:y',
          slugOf: () => 'my-article',
          refOf: (slug) => (slug === 'my-article' ? 'b:x' : ''),
          indexReady: true,
          hasDoc: false,
          onPick,
          onClear: () => {},
        }),
      { wrapper: wrapper('/reader/a/my-article') },
    )

    await waitFor(() => expect(onPick).toHaveBeenCalledWith('b:x'))
    expect(result.current.articleRouting).toEqual({
      slug: 'my-article',
      indexReady: true,
      ref: 'b:x',
      currentRef: 'b:y',
    })
  })
})
