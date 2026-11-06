import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createServer, request } from 'node:http'
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
 */

const lib = (n) => ({
  schemaVersion: 1,
  items: Array.from({ length: n }, (_, i) => ({ id: `w${i}`, word: `w${i}`, lemma: `w${i}` })),
})

let server
let baseUrl
let updatedAt

beforeAll(async () => {
  const dbPath = join(mkdtempSync(join(tmpdir(), 'xueba-storeapi-')), 'xueba.db')
  const store = openStore(dbPath)
  const saved = await store.saveVocab(lib(120)) // >1KB，才会触发 gzip
  updatedAt = saved.updatedAt

  server = createServer((req, res) => {
    handleStoreApi(req, res, { dbPath }).catch(() => {
      res.statusCode = 500
      res.end('store error')
    })
  })
  await new Promise((r) => server.listen(0, '127.0.0.1', r))
  baseUrl = `http://127.0.0.1:${server.address().port}`
})

afterAll(async () => {
  await new Promise((r) => server.close(r))
  closeAllStores()
})

describe('GET /vocab：响应形状与压缩', () => {
  it('带 Accept-Encoding: gzip 时压缩发送，解压后数据完整', async () => {
    const res = await fetch(`${baseUrl}/api/store/vocab`, { headers: { 'accept-encoding': 'gzip' } })
    expect(res.status).toBe(200)
    expect(res.headers.get('content-encoding')).toBe('gzip')
    expect(res.headers.get('vary')).toContain('Accept-Encoding')

    const j = await res.json() // fetch 会自动解压
    expect(j.ok).toBe(true)
    expect(j.count).toBe(120)
    expect(j.value.items).toHaveLength(120)
    expect(j.updatedAt).toBe(updatedAt)
  })

  it('不带 gzip 时原样返回（curl / 脚本调试友好）', async () => {
    const res = await fetch(`${baseUrl}/api/store/vocab`, { headers: { 'accept-encoding': 'identity' } })
    expect(res.status).toBe(200)
    expect(res.headers.get('content-encoding')).toBeNull()
    const j = await res.json()
    expect(j.value.items.slice(0, 3).map((x) => x.word)).toEqual(["w0", "w1", "w2"])
  })

  it('空库也返回 value: null，不是 404', async () => {
    const dbPath = join(mkdtempSync(join(tmpdir(), 'xueba-storeapi-empty-')), 'xueba.db')
    const empty = createServer((req, res) => {
      handleStoreApi(req, res, { dbPath }).catch(() => {
        res.statusCode = 500
        res.end('store error')
      })
    })
    await new Promise((r) => empty.listen(0, '127.0.0.1', r))
    const url = `http://127.0.0.1:${empty.address().port}/api/store/vocab`
    const j = await (await fetch(url)).json()
    expect(j).toEqual({ ok: true, value: null, updatedAt: null, count: 0 })
    await new Promise((r) => empty.close(r))
    closeAllStores()
  })

  it('无 Origin 的 evil Host 读 GET 也拒绝（dev 插件直连路径）', async () => {
    const status = await new Promise((resolve, reject) => {
      const req = request(
        {
          host: '127.0.0.1',
          port: server.address().port,
          path: '/api/store/vocab',
          method: 'GET',
          // 浏览器 DNS 重绑定后的同源 GET：没有 Origin，只有 evil Host。
          headers: { Host: `evil.test:${server.address().port}` },
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
    const put = (body) =>
      fetch(`${baseUrl}/api/store/learning`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      })
    const payload = {
      practice: [{ at: '2026-01-01T00:00:00.000Z', kind: 'quiz', total: 1, correct: 1 }],
    }
    expect((await put(payload)).status).toBe(200)

    const created = await (
      await fetch(`${baseUrl}/api/store/learning/snapshots`, { method: 'POST' })
    ).json()
    expect(created.ok).toBe(true)
    expect(typeof created.value).toBe('string')

    const list = await (await fetch(`${baseUrl}/api/store/learning/snapshots`)).json()
    expect(list.ok).toBe(true)
    expect(list.value.some((s) => s.at === created.value && s.reason === 'manual')).toBe(true)

    await put({ practice: [] })
    const empty = await (await fetch(`${baseUrl}/api/store/learning`)).json()
    expect(empty.value.practice).toHaveLength(0)

    const restored = await (
      await fetch(`${baseUrl}/api/store/learning/snapshots/restore`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ at: created.value }),
      })
    ).json()
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
