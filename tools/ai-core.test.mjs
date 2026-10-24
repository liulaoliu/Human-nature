import { Readable } from 'node:stream'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { handleAiApi, runJobs } from './ai-core.mjs'

const cfg = { baseUrl: 'http://api.test', apiKey: 'k', model: 'm', concurrency: 1 }

const reply = (raw) => ({
  ok: true,
  json: async () => ({ choices: [{ message: { content: raw } }] }),
  text: async () => '',
})

const ENV_KEYS = ['DEEPSEEK_API_KEY', 'OPENAI_API_KEY', 'AI_BASE_URL', 'AI_MODEL']
let savedEnv = {}

beforeEach(() => {
  savedEnv = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]))
  process.env.DEEPSEEK_API_KEY = 'test-key'
  process.env.AI_BASE_URL = 'http://api.test'
})

afterEach(() => {
  vi.unstubAllGlobals()
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k]
    else process.env[k] = savedEnv[k]
  }
})

function fakeReq({ url, method = 'POST', body = '' }) {
  const req = Readable.from(body ? [body] : [])
  req.url = url
  req.method = method
  return req
}

function fakeRes() {
  let finish
  const done = new Promise((resolve) => {
    finish = resolve
  })
  const res = {
    statusCode: 0,
    body: '',
    setHeader() {},
    end(chunk = '') {
      this.body += chunk
      finish()
    },
  }
  return { res, done }
}

/** 真正走一遍 handleAiApi 的 HTTP 分支（不是只测 runJobs）。 */
async function callApi(req) {
  const { res, done } = fakeRes()
  handleAiApi(req, res, { root: process.cwd() })
  await done
  return { status: res.statusCode, body: JSON.parse(res.body || '{}') }
}

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

describe('handleAiApi：启动/取消的 HTTP 语义', () => {
  it('启动后取消：状态变 cancelled，在途模型请求被打断，不再发新的', async () => {
    let modelCalls = 0
    vi.stubGlobal(
      'fetch',
      vi.fn((_url, init) => {
        modelCalls += 1
        return new Promise((_resolve, reject) => {
          init.signal?.addEventListener('abort', () => {
            const err = new Error('aborted')
            err.name = 'AbortError'
            reject(err)
          })
        })
      }),
    )
    const runId = 'run-test-cancel-1'
    const start = await callApi(
      fakeReq({
        url: `/api/ai/run?runId=${runId}`,
        body: JSON.stringify({ jobs: [{ id: 'a', task: 't', prompt: 'p' }] }),
      }),
    )
    expect(start.status).toBe(200)
    expect(start.body).toMatchObject({ runId, total: 1 })
    // 让 runJobs 真正把模型请求发出去
    await new Promise((r) => setTimeout(r, 0))
    expect(modelCalls).toBe(1)

    const cancel = await callApi(fakeReq({ url: '/api/ai/cancel', body: JSON.stringify({ runId }) }))
    expect(cancel.body).toMatchObject({ runId, state: 'cancelled', done: 0, total: 1 })

    const poll = await callApi(fakeReq({ url: `/api/ai/run?id=${runId}`, method: 'GET' }))
    expect(poll.body.state).toBe('cancelled')
    expect(modelCalls).toBe(1)
  })

  it('取消比启动先到：墓碑让后续启动直接取消，一个模型请求都不发', async () => {
    let modelCalls = 0
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        modelCalls += 1
        return reply('x')
      }),
    )
    const runId = 'run-test-late-1'
    const cancel = await callApi(fakeReq({ url: '/api/ai/cancel', body: JSON.stringify({ runId }) }))
    expect(cancel.status).toBe(404)

    const start = await callApi(
      fakeReq({
        url: `/api/ai/run?runId=${runId}`,
        body: JSON.stringify({ jobs: [{ id: 'a', task: 't', prompt: 'p' }] }),
      }),
    )
    expect(start.status).toBe(200)
    expect(start.body).toMatchObject({ runId, state: 'cancelled' })
    expect(modelCalls).toBe(0)
  })
})
