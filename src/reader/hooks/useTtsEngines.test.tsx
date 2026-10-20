// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { useTtsEngines } from './useTtsEngines'

const originalFetch = globalThis.fetch

beforeEach(() => {
  globalThis.fetch = vi.fn()
})

afterEach(() => {
  globalThis.fetch = originalFetch
  vi.restoreAllMocks()
})

function okResponse(body: unknown): Response {
  return { ok: true, json: async () => body } as Response
}

describe('useTtsEngines', () => {
  it('探测成功：返回服务端引擎信息', async () => {
    const payload = { edge: true, sapi: true, piper: false, voices: [] }
    vi.mocked(fetch).mockResolvedValue(okResponse(payload))
    const { result } = renderHook(() => useTtsEngines())
    await waitFor(() => expect(result.current).toEqual(payload))
    expect(fetch).toHaveBeenCalledWith('/api/tts/engines')
  })

  it('服务端未起 / 非 2xx：保持 null（只用 Edge）', async () => {
    vi.mocked(fetch).mockResolvedValue({ ok: false, json: async () => ({ edge: true }) } as Response)
    const { result } = renderHook(() => useTtsEngines())
    await waitFor(() => expect(fetch).toHaveBeenCalled())
    expect(result.current).toBeNull()
  })

  it('网络异常：吞掉错误，保持 null', async () => {
    vi.mocked(fetch).mockRejectedValue(new Error('offline'))
    const { result } = renderHook(() => useTtsEngines())
    await waitFor(() => expect(fetch).toHaveBeenCalled())
    expect(result.current).toBeNull()
  })

  it('返回值不是对象（异常服务端）：忽略', async () => {
    vi.mocked(fetch).mockResolvedValue(okResponse('nope'))
    const { result } = renderHook(() => useTtsEngines())
    await waitFor(() => expect(fetch).toHaveBeenCalled())
    expect(result.current).toBeNull()
  })

  it('卸载后完成的探测不写状态', async () => {
    let finish: (r: Response) => void = () => {}
    vi.mocked(fetch).mockReturnValue(new Promise<Response>((resolve) => (finish = resolve)))
    const { unmount } = renderHook(() => useTtsEngines())
    unmount()
    finish(okResponse({ edge: true }))
    await Promise.resolve()
    expect(fetch).toHaveBeenCalledTimes(1)
  })
})
