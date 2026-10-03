import { describe, it, expect } from 'vitest'
import { createServer } from 'node:http'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { contentType, safeJoin } from './util.js'
import { restartDecision } from './watchdog.js'
import { getPort } from './status.js'
import { createRequestHandler } from './httpApp.js'
import { resolveChild, loadMode } from './mode.js'

describe('util', () => {
  it('contentType 按扩展名', () => {
    expect(contentType('a.html')).toContain('text/html')
    expect(contentType('x.JS')).toContain('javascript')
    expect(contentType('weird.bin')).toBe('application/octet-stream')
  })
  it('safeJoin 阻止路径越界', () => {
    const root = resolve('root-base')
    expect(safeJoin(root, '/a/b.txt')).toBe(resolve(root, 'a/b.txt'))
    expect(safeJoin(root, '/../secret')).toBeNull()
    expect(safeJoin(root, '/a/../../secret')).toBeNull()
  })
})

describe('watchdog.restartDecision', () => {
  it('正常退出不重启', () => {
    expect(restartDecision({ code: 0, consecutive: 0, maxRestarts: 5 }).restart).toBe(false)
  })
  it('崩溃则重启', () => {
    expect(restartDecision({ code: 1, consecutive: 0, maxRestarts: 5 }).restart).toBe(true)
  })
  it('连续崩溃到上限停止', () => {
    expect(restartDecision({ code: 1, consecutive: 5, maxRestarts: 5 }).restart).toBe(false)
  })
})

describe('status.getPort', () => {
  it('命令行参数优先', () => {
    expect(getPort('6000')).toBe(6000)
  })
})

describe('httpApp 请求处理', () => {
  it('status / __state / 静态 / 404', async () => {
    const dist = mkdtempSync(join(tmpdir(), 'sa-dist-'))
    const pub = mkdtempSync(join(tmpdir(), 'sa-pub-'))
    mkdirSync(join(dist, 'assets'), { recursive: true })
    writeFileSync(join(dist, 'index.html'), '<!doctype html><title>t</title>')
    const server = createServer(createRequestHandler({ distDir: dist, publicDir: pub }))
    await new Promise((r) => server.listen(0, r))
    const port = server.address().port
    try {
      const st = await fetch(`http://127.0.0.1:${port}/api/status`).then((r) => r.json())
      expect(st.ok).toBe(true)
      expect(st.pid).toBe(process.pid)

      const body = JSON.stringify({ hello: 'world' })
      const put = await fetch(`http://127.0.0.1:${port}/__state`, { method: 'POST', body })
      expect(put.status).toBe(200)
      expect(JSON.parse(readFileSync(join(pub, 'shadowing-state.json'), 'utf8'))).toEqual({ hello: 'world' })

      const idx = await fetch(`http://127.0.0.1:${port}/`).then((r) => r.text())
      expect(idx).toContain('<title>t</title>')

      const bad = await fetch(`http://127.0.0.1:${port}/__state`, { method: 'POST', body: 'not json' })
      expect(bad.status).toBe(400)

      const missing = await fetch(`http://127.0.0.1:${port}/nope.xyz`)
      expect(missing.status).toBe(404)
    } finally {
      await new Promise((r) => server.close(r))
    }
  })
})

describe('mode.resolveChild / loadMode', () => {
  it('static 模式跑 appServer', () => {
    const c = resolveChild(resolve('.'), 'static')
    expect(c.args[0].endsWith('appServer.js')).toBe(true)
  })
  it('dev 模式优先 vite（装了依赖时）', () => {
    const c = resolveChild(resolve('.'), 'dev')
    expect(c.args[0].includes('vite') || c.args[0].endsWith('appServer.js')).toBe(true)
  })
  it('默认模式是 dev', () => {
    expect(loadMode(resolve('.'))).toBe('dev')
  })
})
