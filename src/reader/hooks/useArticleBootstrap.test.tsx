// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { useArticleBootstrap } from './useArticleBootstrap'

const mocks = vi.hoisted(() => ({ list: vi.fn(), reconcile: vi.fn() }))
vi.mock('../../adapters/articleRepo', () => ({
  createArticleRepo: () => ({ list: mocks.list, reconcile: mocks.reconcile }),
}))

function mockBookFetch(ok = true) {
  const fn = vi.fn(async () => ({
    ok,
    status: ok ? 200 : 500,
    json: async () => ({ books: [] }),
  }))
  vi.stubGlobal('fetch', fn)
  return fn
}

beforeEach(() => {
  mocks.list.mockReset()
  mocks.reconcile.mockReset().mockResolvedValue(undefined)
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('useArticleBootstrap', () => {
  it('先迁移再取列表，同时加载内置目录', async () => {
    const list = [{ id: 'a1', title: 'A', sentences: [] }]
    mocks.list.mockResolvedValue(list)
    mockBookFetch()

    const { result } = renderHook(() => useArticleBootstrap())
    await waitFor(() => expect(result.current.savedLoaded).toBe(true))

    expect(mocks.reconcile).toHaveBeenCalled()
    expect(result.current.saved).toEqual(list)
    expect(result.current.articles.current).toBeTruthy()
    await waitFor(() => expect(result.current.book).toEqual({ books: [] }))
    expect(result.current.bookError).toBe(false)
  })

  it('迁移失败只 warn，不挡列表', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    mocks.reconcile.mockRejectedValue(new Error('sqlite down'))
    mocks.list.mockResolvedValue([])
    mockBookFetch()

    const { result } = renderHook(() => useArticleBootstrap())
    await waitFor(() => expect(result.current.savedLoaded).toBe(true))

    expect(warn).toHaveBeenCalledWith('[文章] 启动迁移失败', expect.any(Error))
    expect(result.current.saved).toEqual([])
  })

  it('列表失败不静默，标记 loaded 并保留空表', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    mocks.list.mockRejectedValue(new Error('indexeddb blocked'))
    mockBookFetch()

    const { result } = renderHook(() => useArticleBootstrap())
    await waitFor(() => expect(result.current.savedLoaded).toBe(true))

    expect(warn).toHaveBeenCalledWith('[文章] 已保存列表加载失败', expect.any(Error))
    expect(result.current.saved).toEqual([])
  })

  it('内置目录取不到时置 bookError', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    mocks.list.mockResolvedValue([])
    mockBookFetch(false)

    const { result } = renderHook(() => useArticleBootstrap())
    await waitFor(() => expect(result.current.bookError).toBe(true))
    expect(result.current.book).toBeNull()
  })
})
