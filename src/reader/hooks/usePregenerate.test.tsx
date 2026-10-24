// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { usePregenerate } from './usePregenerate'

function mockTts(cached: (text: string) => boolean) {
  const calls: string[] = []
  const fn = vi.fn(async (url: string) => {
    calls.push(url)
    const text = decodeURIComponent(new URL(url, 'http://x').searchParams.get('text') ?? '')
    return { ok: true, json: async () => ({ cached: cached(text) }) } as Response
  })
  vi.stubGlobal('fetch', fn)
  return calls
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('usePregenerate', () => {
  it('先查缓存，只合成缺的句子', async () => {
    const calls = mockTts((t) => t === 'hello')
    const sentences = [{ text: 'hello' }, { text: 'world' }]
    const { result } = renderHook(() => usePregenerate({ sentences, voice: 'v1' }))

    await act(async () => {
      await result.current.pregenerateAll()
    })

    expect(calls.filter((u) => u.includes('check=1'))).toHaveLength(2)
    const synth = calls.filter((u) => !u.includes('check=1'))
    expect(synth).toHaveLength(1)
    expect(synth[0]).toContain('text=world')
    expect(result.current.pregen).toEqual({ done: 1, total: 1, running: false, allCached: false })
  })

  it('全部命中缓存时不合成', async () => {
    const calls = mockTts(() => true)
    const sentences = [{ text: 'hello' }, { text: 'world' }]
    const { result } = renderHook(() => usePregenerate({ sentences, voice: 'v1' }))

    await act(async () => {
      await result.current.pregenerateAll()
    })

    expect(calls.every((u) => u.includes('check=1'))).toBe(true)
    expect(result.current.pregen).toEqual({ done: 2, total: 2, running: false, allCached: true })
  })

  it('没有句子时什么都不做', async () => {
    const calls = mockTts(() => false)
    const { result } = renderHook(() => usePregenerate({ sentences: null, voice: 'v1' }))

    await act(async () => {
      await result.current.pregenerateAll()
    })

    expect(calls).toEqual([])
    expect(result.current.pregen).toEqual({ done: 0, total: 0, running: false, allCached: false })
  })

  it('取消后不再合成，进度停住并结束', async () => {
    const calls: string[] = []
    let release!: () => void
    const gate = new Promise<void>((r) => {
      release = r
    })
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        calls.push(url)
        await gate
        return { ok: true, json: async () => ({ cached: false }) } as Response
      }),
    )
    const { result } = renderHook(() =>
      usePregenerate({ sentences: [{ text: 'hello' }, { text: 'world' }], voice: 'v1' }),
    )

    let run!: Promise<void>
    act(() => {
      run = result.current.pregenerateAll()
    })
    act(() => result.current.cancelPregenerate())
    await act(async () => {
      release()
      await run
    })

    expect(calls.every((u) => u.includes('check=1'))).toBe(true)
    expect(result.current.pregen.running).toBe(false)
  })

  it('换文章后旧 run 被取消：不再推进度，也不把结果写到新文章上', async () => {
    let release!: () => void
    const gate = new Promise<void>((r) => {
      release = r
    })
    const signals: (AbortSignal | undefined)[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init?: RequestInit) => {
        signals.push(init?.signal ?? undefined)
        await gate
        return { ok: true, json: async () => ({ cached: false }) } as Response
      }),
    )
    const { result, rerender } = renderHook((props) => usePregenerate(props), {
      initialProps: { sentences: [{ text: 'old' }], voice: 'v1' },
    })

    let run!: Promise<void>
    act(() => {
      run = result.current.pregenerateAll()
    })
    rerender({ sentences: [{ text: 'new' }], voice: 'v1' })
    release()
    await act(async () => {
      await run
    })

    expect(signals[0]).toBeInstanceOf(AbortSignal)
    expect(result.current.pregen.done).toBe(0)
    expect(result.current.pregen.running).toBe(false)
  })

  it('换音色后「已全部缓存」失效', async () => {
    mockTts(() => true)
    const sentences = [{ text: 'hello' }]
    const { result, rerender } = renderHook((props) => usePregenerate(props), {
      initialProps: { sentences, voice: 'v1' },
    })
    await act(async () => {
      await result.current.pregenerateAll()
    })
    expect(result.current.pregen.allCached).toBe(true)

    rerender({ sentences, voice: 'v2' })
    expect(result.current.pregen.allCached).toBe(false)
  })
})
