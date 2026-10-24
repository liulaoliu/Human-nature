import { afterEach, describe, expect, it, vi } from 'vitest'
import { CANCEL_MESSAGE, fetchAiStatus, runAiBatch } from './aiRun'

const json = (body: unknown, ok = true): Response => ({ ok, json: async () => body }) as unknown as Response

const jobs = [
  { id: 'a', task: 'lookup', prompt: 'p1' },
  { id: 'b', task: 'translate', prompt: 'p2' },
]

/**
 * 只 mock HTTP：`/api/ai/status` 固定、`POST /api/ai/run` 起跑、`GET ?id=` 轮询。
 * 轮询行为由各用例决定。
 */
function stubFetch(poll: () => Promise<Response>, post: () => Promise<Response> = async () => json({ runId: 'r1' })) {
  const f = vi.fn(async (url: string) => {
    if (url.startsWith('/api/ai/run?id=')) return poll()
    if (url === '/api/ai/run') return post()
    return json({ configured: true })
  })
  return f as unknown as typeof fetch
}

afterEach(() => {
  vi.useRealTimers()
})

describe('fetchAiStatus：只回布尔，失败当没配', () => {
  it('配了 key', async () => {
    expect(await fetchAiStatus(stubFetch(async () => json({ state: 'done' })))).toBe(true)
  })

  it('接口挂了 / 断网 → false（不抛）', async () => {
    const boom = vi.fn(async () => {
      throw new Error('offline')
    }) as unknown as typeof fetch
    expect(await fetchAiStatus(boom)).toBe(false)
  })

  it('非 2xx → false', async () => {
    const deny = vi.fn(async () => json({ configured: true }, false)) as unknown as typeof fetch
    expect(await fetchAiStatus(deny)).toBe(false)
  })
})

describe('runAiBatch：轮询到结束', () => {
  it('done：返回结果并回调进度', async () => {
    vi.useFakeTimers()
    const onProgress = vi.fn()
    const results = [{ id: 'a', task: 'lookup', raw: 'x' }]
    const fetchImpl = stubFetch(async () => json({ state: 'done', done: 2, results, failed: [] }))

    const p = runAiBatch(jobs, { signal: new AbortController().signal, onProgress, fetchImpl })
    await vi.advanceTimersByTimeAsync(1500)
    const out = await p

    expect(out.results).toEqual(results)
    expect(out.failed).toEqual([])
    expect(onProgress).toHaveBeenCalledWith(2)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('服务端 results 混入坏条目：过滤并报告丢弃数，不把 raw.trim 留到应用层才炸', async () => {
    vi.useFakeTimers()
    const fetchImpl = stubFetch(async () =>
      json({
        state: 'done',
        done: 3,
        results: [null, { id: 'a', raw: 'x' }, { id: 'b', raw: 3 }],
        failed: [{ id: 'c', error: '429' }, null],
      }),
    )
    const p = runAiBatch(jobs, { signal: new AbortController().signal, fetchImpl })
    await vi.advanceTimersByTimeAsync(1500)
    const out = await p
    expect(out.results).toEqual([{ id: 'a', raw: 'x' }])
    expect(out.dropped).toBe(2)
    expect(out.failed).toEqual([{ id: 'c', error: '429' }])
  })

  it('服务端报错 → 抛「跑批出错」并清定时器', async () => {
    vi.useFakeTimers()
    const fetchImpl = stubFetch(async () => json({ state: 'error', error: '模型 429' }))
    const p = runAiBatch(jobs, { signal: new AbortController().signal, fetchImpl })
    const guard = expect(p).rejects.toThrow('跑批出错：模型 429')
    await vi.advanceTimersByTimeAsync(1500)
    await guard
    expect(vi.getTimerCount()).toBe(0)
  })

  it('起跑就失败（没配 key）→ 提示去填 config.local.json', async () => {
    const fetchImpl = stubFetch(
      async () => json({ state: 'done' }),
      async () => json({ error: 'no-key' }, false),
    )
    await expect(runAiBatch(jobs, { signal: new AbortController().signal, fetchImpl })).rejects.toThrow(
      /config\.local\.json/,
    )
  })

  it('连续 20 次取不到进度 → 判失联', async () => {
    vi.useFakeTimers()
    const fetchImpl = stubFetch(async () => {
      throw new Error('network down')
    })
    const p = runAiBatch(jobs, { signal: new AbortController().signal, fetchImpl })
    const guard = expect(p).rejects.toThrow('与服务端失联')
    await vi.advanceTimersByTimeAsync(20 * 1500 + 100)
    await guard
    expect(vi.getTimerCount()).toBe(0)
  })

  it('取消：抛 CANCEL_MESSAGE，不再继续请求', async () => {
    vi.useFakeTimers()
    const ctrl = new AbortController()
    const polls = vi.fn(async () => json({ state: 'running', done: 1 }))
    const fetchImpl = stubFetch(polls)

    const p = runAiBatch(jobs, { signal: ctrl.signal, fetchImpl })
    const guard = expect(p).rejects.toThrow(CANCEL_MESSAGE)
    await vi.advanceTimersByTimeAsync(1500)
    ctrl.abort()
    await guard
    expect(polls).toHaveBeenCalledTimes(1)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('取消会先通知服务端 /api/ai/cancel（带 runId），别让服务端继续花额度', async () => {
    vi.useFakeTimers()
    const ctrl = new AbortController()
    const calls: { url: string; init?: RequestInit }[] = []
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, init })
      if (url === '/api/ai/run') return json({ runId: 'r9' })
      if (url.startsWith('/api/ai/run?id=')) return json({ state: 'running', done: 1 })
      return json({ runId: 'r9', state: 'cancelled' })
    }) as unknown as typeof fetch

    const p = runAiBatch(jobs, { signal: ctrl.signal, fetchImpl })
    const guard = expect(p).rejects.toThrow(CANCEL_MESSAGE)
    await vi.advanceTimersByTimeAsync(1500)
    ctrl.abort()
    await guard

    const cancel = calls.find((c) => c.url === '/api/ai/cancel')
    expect(cancel?.init?.method).toBe('POST')
    expect(JSON.parse(String(cancel?.init?.body))).toEqual({ runId: 'r9' })
  })

  it('服务端已被别处取消 → 按取消处理，不报成跑批错误', async () => {
    vi.useFakeTimers()
    const fetchImpl = stubFetch(async () => json({ state: 'cancelled', done: 1 }))
    const p = runAiBatch(jobs, { signal: new AbortController().signal, fetchImpl })
    const guard = expect(p).rejects.toThrow(CANCEL_MESSAGE)
    await vi.advanceTimersByTimeAsync(1500)
    await guard
  })
})
