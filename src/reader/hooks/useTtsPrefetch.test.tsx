// @vitest-environment jsdom
import { useCallback } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, render } from '@testing-library/react'
import { useTtsPrefetch } from './useTtsPrefetch'
import type { WordTiming } from '../../core/ttsTiming'
import { sentenceFixture } from '../../core/testFixtures'

/**
 * 预热层：选中句向后预热、同文本去重、服务端降级时暂停（队列留着）、换音色清缓存。
 * 只钉请求接线，不碰真实音频（见 docs/TESTING.md §4）。
 */
let api: ReturnType<typeof useTtsPrefetch> | null = null
let cache: Map<string, WordTiming[]> = new Map()
const doc = {
  sentences: [sentenceFixture('s1', 'One.'), sentenceFixture('s2', 'Two.'), sentenceFixture('s3', 'Three.')],
}

function Harness({
  voice = 'edge-en-us',
  selectedId = null,
  serverUp = true,
}: {
  voice?: string
  selectedId?: string | null
  serverUp?: boolean
}) {
  const canUseServer = useCallback(() => serverUp, [serverUp])
  api = useTtsPrefetch({ doc, selectedId, voice, canUseServer, timingsCache: cache })
  return null
}

const fetchMock = vi.fn(async (_url: string): Promise<{ ok: boolean; json: () => Promise<unknown> }> => ({
  ok: true,
  json: async () => [],
}))
const urls = () => fetchMock.mock.calls.map((c) => String(c[0]))

beforeEach(() => {
  api = null
  cache = new Map()
  vi.clearAllMocks()
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

/** 预热队列是串行的，冲一轮微任务让 HEAD 全部发完。 */
async function flush() {
  await act(async () => {
    for (let i = 0; i < 5; i++) await Promise.resolve()
  })
}

describe('useTtsPrefetch：选中即预热', () => {
  it('从选中句开始向后预热，不碰前面的句子', async () => {
    render(<Harness selectedId="s2" />)
    await flush()
    const head = urls().filter((u) => u.startsWith('/api/tts?'))
    expect(head.some((u) => u.includes('Two.'))).toBe(true)
    expect(head.some((u) => u.includes('Three.'))).toBe(true)
    expect(head.some((u) => u.includes('One.'))).toBe(false)
  })

  it('同一句重复预热只发一次 HEAD', async () => {
    render(<Harness />)
    act(() => {
      api!.warmTexts(['Same.'])
      api!.warmTexts(['Same.'])
    })
    await flush()
    expect(urls().filter((u) => u.includes('Same.'))).toHaveLength(1)
  })
})

describe('useTtsPrefetch：降级与音色', () => {
  it('服务端降级期不预热，队列留着；恢复后连同旧队列一起发', async () => {
    const { rerender } = render(<Harness serverUp={false} />)
    act(() => api!.warmTexts(['Held.']))
    await flush()
    expect(fetchMock).not.toHaveBeenCalled()

    rerender(<Harness serverUp />)
    act(() => api!.warmTexts(['After.']))
    await flush()
    const head = urls().filter((u) => u.startsWith('/api/tts?'))
    expect(head.some((u) => u.includes('Held.'))).toBe(true)
    expect(head.some((u) => u.includes('After.'))).toBe(true)
  })

  it('warmTimings 取回后进共享缓存；换音色清空', async () => {
    fetchMock.mockImplementation(async () => ({
      ok: true,
      json: async () => [{ part: 'Hi', start: 0, end: 200 }],
    }))
    const { rerender } = render(<Harness />)
    act(() => api!.warmTimings(['Hi.']))
    await flush()
    expect(cache.size).toBe(1)

    rerender(<Harness voice="edge-en-gb" />)
    expect(cache.size).toBe(0)
  })

  it('离线音色不取时间戳（离线引擎没有逐词时间轴）', async () => {
    render(<Harness voice="local:piper-us" />)
    act(() => api!.warmTimings(['Hi.']))
    await flush()
    expect(urls().some((u) => u.includes('/api/tts/words?'))).toBe(false)
  })
})
