import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createServer } from 'node:http'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { closeAllStores, openStore } from './sqliteStore.js'
import { handleStoreApi } from './storeApi.js'

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
})
