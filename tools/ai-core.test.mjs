import { afterEach, describe, expect, it, vi } from 'vitest'
import { runJobs } from './ai-core.mjs'

const cfg = { baseUrl: 'http://api.test', apiKey: 'k', model: 'm', concurrency: 1 }

const reply = (raw) => ({
  ok: true,
  json: async () => ({ choices: [{ message: { content: raw } }] }),
  text: async () => '',
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('runJobs：取消后不再花额度', () => {
  it('abort 后不再发新请求，在途那条也不记成失败', async () => {
    const ctrl = new AbortController()
    let calls = 0
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        calls += 1
        // 模拟用户在第一请求还没回来时点了取消
        ctrl.abort()
        return reply('ok')
      }),
    )
    const jobs = Array.from({ length: 5 }, (_, i) => ({ id: `j${i}`, task: 't', prompt: 'p' }))

    const out = await runJobs(jobs, cfg, { signal: ctrl.signal })

    expect(calls).toBe(1)
    expect(out.filter(Boolean)).toHaveLength(0)
  })

  it('重试退避期间取消也立刻结束', async () => {
    const ctrl = new AbortController()
    let calls = 0
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        calls += 1
        throw new Error('network down')
      }),
    )

    const p = runJobs([{ id: 'a', task: 't', prompt: 'p' }], cfg, { signal: ctrl.signal })
    setTimeout(() => ctrl.abort(), 10)
    const out = await p

    expect(calls).toBe(1)
    expect(out.filter(Boolean)).toHaveLength(0)
  })

  it('正常跑完按原顺序返回，并回调进度', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url, init) => {
        const body = JSON.parse(init.body)
        return reply(body.messages[1].content)
      }),
    )
    const onProgress = vi.fn()
    const out = await runJobs(
      [
        { id: 'a', task: 't', prompt: 'p1' },
        { id: 'b', task: 't', prompt: 'p2' },
      ],
      { ...cfg, concurrency: 2 },
      { onProgress },
    )

    expect(out.map((r) => r.raw)).toEqual(['p1', 'p2'])
    expect(onProgress).toHaveBeenCalledTimes(2)
  })
})
