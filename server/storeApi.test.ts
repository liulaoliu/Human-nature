import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createServer, request, type Server } from 'node:http'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { closeAllStores, openStore } from './sqliteStore.ts'
import { handleStoreApi } from './storeApi.ts'

/**
 * `GET /vocab` 的响应形态：首屏要拉 16MB，所以有两条必须守住：
 *   1. 客户端带 `Accept-Encoding: gzip` 时压着发（16.3MB → 1.5MB）；
 *   2. 响应体是「库里那段 JSON 原样拼进去」的（不 parse 再 stringify），
 *      所以形状必须和以前完全一致 —— 前端只认 `{ ok, value, updatedAt, count }`。
 *
 * 类型说明：`lib.dom` 没进 server 的 tsconfig（lib 只有 ES2022），`Response.json()`
 * 在这里返回 `unknown`，所以响应形状显式声明成本文件的 `VocabResponse` 等类型，
 * 只在 `json<T>()` 这一个边界上断言 —— 别在断言里逐处写 `as any`。
 */

interface TestVocabItem {
  id: string
  word: string
  lemma: string
}
interface TestVocab {
  schemaVersion: number
  items: TestVocabItem[]
}
interface VocabResponse {
  ok: boolean
  value: TestVocab | null
  updatedAt: string | null
  count: number
}
interface LearningResponse {
  ok: boolean
  value: Record<string, unknown[]>
}
interface SnapshotCreated {
  ok: boolean
  value: string
}
interface SnapshotList {
  ok: boolean
  value: { at: string; reason: string }[]
}

const lib = (n: number): TestVocab => ({
  schemaVersion: 1,
  items: Array.from({ length: n }, (_, i) => ({ id: `w${i}`, word: `w${i}`, lemma: `w${i}` })),
})

/** 响应体 → 已知形状（类型断言只在这里发生）。 */
const json = async <T>(res: Response): Promise<T> => (await res.json()) as T

/** `listen(0)` 之后拿实际端口；`address()` 可能是 null 或 unix socket 路径。 */
const portOf = (s: Server): number => {
  const addr = s.address()
  if (addr === null || typeof addr === 'string') throw new Error('服务器没有监听 TCP 端口')
  return addr.port
}

/** 挂上 /api/store 的测试服务器；`ready` 时返回实际端口。 */
const serve = async (dbPath: string): Promise<{ server: Server; url: string }> => {
  const server = createServer((req, res) => {
    handleStoreApi(req, res, { dbPath }).catch(() => {
      res.statusCode = 500
      res.end('store error')
    })
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()))
  return { server, url: `http://127.0.0.1:${portOf(server)}` }
}

let server: Server
let baseUrl: string
let updatedAt: string

beforeAll(async () => {
  const dbPath = join(mkdtempSync(join(tmpdir(), 'xueba-storeapi-')), 'xueba.db')
  const store = openStore(dbPath)
  if (!store) throw new Error('openStore 没返回 Store')
  const saved = await store.saveVocab(lib(120)) // >1KB，才会触发 gzip
  updatedAt = String(saved.updatedAt)

  const started = await serve(dbPath)
  server = started.server
  baseUrl = started.url
})

afterAll(async () => {
  await new Promise<void>((r) => server.close(() => r()))
  closeAllStores()
})

describe('GET /vocab：响应形状与压缩', () => {
  it('带 Accept-Encoding: gzip 时压缩发送，解压后数据完整', async () => {
    const res = await fetch(`${baseUrl}/api/store/vocab`, { headers: { 'accept-encoding': 'gzip' } })
    expect(res.status).toBe(200)
    expect(res.headers.get('content-encoding')).toBe('gzip')
    expect(res.headers.get('vary')).toContain('Accept-Encoding')

    const j = await json<VocabResponse>(res) // fetch 会自动解压
    expect(j.ok).toBe(true)
    expect(j.count).toBe(120)
    expect(j.value?.items).toHaveLength(120)
    expect(j.updatedAt).toBe(updatedAt)
  })

  it('不带 gzip 时原样返回（curl / 脚本调试友好）', async () => {
    const res = await fetch(`${baseUrl}/api/store/vocab`, { headers: { 'accept-encoding': 'identity' } })
    expect(res.status).toBe(200)
    expect(res.headers.get('content-encoding')).toBeNull()
    const j = await json<VocabResponse>(res)
    expect(j.value?.items.slice(0, 3).map((x) => x.word)).toEqual(['w0', 'w1', 'w2'])
  })

  it('空库也返回 value: null，不是 404', async () => {
    const dbPath = join(mkdtempSync(join(tmpdir(), 'xueba-storeapi-empty-')), 'xueba.db')
    const { server: empty, url } = await serve(dbPath)
    const j = await json<VocabResponse>(await fetch(`${url}/api/store/vocab`))
    expect(j).toEqual({ ok: true, value: null, updatedAt: null, count: 0 })
    await new Promise<void>((r) => empty.close(() => r()))
    closeAllStores()
  })

  it('无 Origin 的 evil Host 读 GET 也拒绝（dev 插件直连路径）', async () => {
    const status = await new Promise<number | undefined>((resolve, reject) => {
      const req = request(
        {
          host: '127.0.0.1',
          port: portOf(server),
          path: '/api/store/vocab',
          method: 'GET',
          // 浏览器 DNS 重绑定后的同源 GET：没有 Origin，只有 evil Host。
          headers: { Host: `evil.test:${portOf(server)}` },
        },
        (res) => {
          res.resume()
          res.on('end', () => resolve(res.statusCode))
        },
      )
      req.on('error', reject)
      req.end()
    })
    expect(status).toBe(403)
  })
})

describe('学习记录快照 API', () => {
  it('手动拍 → 列表 → 覆盖 → 恢复；缺 at 返回 400', async () => {
    const put = (body: unknown): Promise<Response> =>
      fetch(`${baseUrl}/api/store/learning`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      })
    const payload = {
      practice: [{ at: '2026-01-01T00:00:00.000Z', kind: 'quiz', total: 1, correct: 1 }],
    }
    expect((await put(payload)).status).toBe(200)

    const created = await json<SnapshotCreated>(
      await fetch(`${baseUrl}/api/store/learning/snapshots`, { method: 'POST' }),
    )
    expect(created.ok).toBe(true)
    expect(typeof created.value).toBe('string')

    const list = await json<SnapshotList>(await fetch(`${baseUrl}/api/store/learning/snapshots`))
    expect(list.ok).toBe(true)
    expect(list.value.some((s) => s.at === created.value && s.reason === 'manual')).toBe(true)

    await put({ practice: [] })
    const empty = await json<LearningResponse>(await fetch(`${baseUrl}/api/store/learning`))
    expect(empty.value.practice).toHaveLength(0)

    const restored = await json<LearningResponse>(
      await fetch(`${baseUrl}/api/store/learning/snapshots/restore`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ at: created.value }),
      }),
    )
    expect(restored.ok).toBe(true)
    expect(restored.value.practice).toHaveLength(1)

    const missing = await fetch(`${baseUrl}/api/store/learning/snapshots/restore`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    })
    expect(missing.status).toBe(400)
  })
})
