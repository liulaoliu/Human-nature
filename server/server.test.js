import { describe, it, expect } from 'vitest'
import { createServer, request } from 'node:http'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { gunzipSync } from 'node:zlib'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { contentType, safeJoin } from './util.js'
import { restartDecision } from './watchdog.js'
import { getPort } from './status.js'
import { createRequestHandler } from './httpApp.js'
import { resolveChild, loadMode } from './mode.js'
import { closeAllStores } from './sqliteStore.js'
import { allowLocalRequest } from './sameOrigin.js'
import { localDayKey } from './localDate.js'

const require = createRequire(import.meta.url)
const { DatabaseSync } = require('node:sqlite')

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

describe('localDayKey', () => {
  it('用本地日历日（不受 UTC 偏移影响）', () => {
    expect(localDayKey(new Date(2026, 0, 1, 0, 30))).toBe('2026-01-01')
    expect(localDayKey(new Date(2026, 11, 31, 23, 59))).toBe('2026-12-31')
  })
})

describe('sameOrigin', () => {
  it('同源放行；跨站 Origin / Sec-Fetch-Site 拒绝；无 Origin 的本机脚本放行', () => {
    expect(allowLocalRequest({ headers: { host: 'localhost:5173', origin: 'http://localhost:5173' } })).toBe(true)
    expect(allowLocalRequest({ headers: { host: 'localhost:5173', origin: 'http://evil.test' } })).toBe(false)
    expect(allowLocalRequest({ headers: { host: 'localhost:5173', 'sec-fetch-site': 'cross-site' } })).toBe(false)
    expect(allowLocalRequest({ headers: { host: 'localhost:5173' } })).toBe(true)
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

      const evilState = await fetch(`http://127.0.0.1:${port}/__state`, {
        method: 'POST',
        headers: { Origin: 'http://evil.test' },
        body,
      })
      expect(evilState.status).toBe(403)

      const evilAi = await fetch(`http://127.0.0.1:${port}/api/ai/run`, {
        method: 'POST',
        headers: { Origin: 'http://evil.test', 'Content-Type': 'application/json' },
        body: '{}',
      })
      expect(evilAi.status).toBe(403)

      const crossTts = await fetch(`http://127.0.0.1:${port}/api/tts?text=hello`, {
        headers: { 'Sec-Fetch-Site': 'cross-site' },
      })
      expect(crossTts.status).toBe(403)

      const missing = await fetch(`http://127.0.0.1:${port}/nope.xyz`)
      expect(missing.status).toBe(404)
    } finally {
      await new Promise((r) => server.close(r))
    }
  })

  it('SQLite store：健康 / 词库 / 文章 / 导出 / 同源校验', async () => {
    const dist = mkdtempSync(join(tmpdir(), 'sa-dist-'))
    const pub = mkdtempSync(join(tmpdir(), 'sa-pub-'))
    const dbPath = join(mkdtempSync(join(tmpdir(), 'sa-db-')), 'xueba.db')
    mkdirSync(join(dist, 'assets'), { recursive: true })
    writeFileSync(join(dist, 'index.html'), 'x')
    const server = createServer(createRequestHandler({ distDir: dist, publicDir: pub, dbPath }))
    await new Promise((r) => server.listen(0, '127.0.0.1', r))
    const base = `http://127.0.0.1:${server.address().port}`
    const json = (init) => ({ 'Content-Type': 'application/json', ...init })
    try {
      const health = await fetch(`${base}/api/store/health`).then((r) => r.json())
      expect(health).toMatchObject({ ok: true, engine: 'sqlite' })
      // 不向页面泄露数据库绝对路径（截图/日志分享时）
      expect(health.path).toBeUndefined()

      const library = { items: [{ id: 'w1', word: 'test' }], stats: {} }
      const putVocab = await fetch(`${base}/api/store/vocab`, {
        method: 'PUT',
        headers: json(),
        body: JSON.stringify(library),
      })
      expect(putVocab.status).toBe(200)
      const got = await fetch(`${base}/api/store/vocab`).then((r) => r.json())
      expect(got.value.items).toHaveLength(1)
      expect(got.updatedAt).toBeTruthy()

      // 乐观锁：带着过期版本号写 → 409，库不动
      const stale = await fetch(`${base}/api/store/vocab`, {
        method: 'PUT',
        headers: { ...json(), 'X-Vocab-Base': '2000-01-01T00:00:00.000Z' },
        body: JSON.stringify({ items: [], stats: {} }),
      })
      expect(stale.status).toBe(409)
      expect((await stale.json()).count).toBe(1)
      expect((await fetch(`${base}/api/store/vocab`).then((r) => r.json())).value.items).toHaveLength(1)

      // 带着最新版本号写 → 放行
      const fresh = await fetch(`${base}/api/store/vocab`, {
        method: 'PUT',
        headers: { ...json(), 'X-Vocab-Base': got.updatedAt },
        body: JSON.stringify({ items: [...library.items, { id: 'w2', word: 'more' }], stats: {} }),
      })
      expect(fresh.status).toBe(200)
      expect((await fresh.json()).updatedAt).not.toBe(got.updatedAt)

      // 还原成原来的内容，后面的「相同内容不重复写」才测得准（不带 base = 强制写）
      await fetch(`${base}/api/store/vocab`, { method: 'PUT', headers: json(), body: JSON.stringify(library) })

      // 相同内容重复 PUT：不再写快照 / 重建派生表
      const snapsBefore = (await fetch(`${base}/api/store/vocab/snapshots`).then((r) => r.json())).snapshots.length
      await fetch(`${base}/api/store/vocab`, {
        method: 'PUT',
        headers: json(),
        body: JSON.stringify(library),
      })
      const snapsAfter = (await fetch(`${base}/api/store/vocab/snapshots`).then((r) => r.json())).snapshots.length
      expect(snapsAfter).toBe(snapsBefore)

      const article = {
        id: 'a1',
        title: 'A',
        text: 'x',
        paragraphs: [],
        sentences: [],
        sourceKey: null,
        updatedAt: '2026-01-01T00:00:00.000Z',
      }
      const putArticle = await fetch(`${base}/api/store/articles/a1`, {
        method: 'PUT',
        headers: json(),
        body: JSON.stringify(article),
      })
      expect(putArticle.status).toBe(200)
      expect((await fetch(`${base}/api/store/articles`).then((r) => r.json())).articles[0].id).toBe('a1')

      const putArticle2 = await fetch(`${base}/api/store/articles/a1`, {
        method: 'PUT',
        headers: json(),
        body: JSON.stringify({ ...article, title: 'A2', updatedAt: '2026-01-02T00:00:00.000Z' }),
      })
      expect(putArticle2.status).toBe(200)
      const articlePrev = await fetch(`${base}/api/store/articles/a1/prev`).then((r) => r.json())
      expect(articlePrev.value.value.title).toBe('A')
      const restoreArticle = await fetch(`${base}/api/store/articles/a1/restore-prev`, {
        method: 'POST',
        headers: json(),
      }).then((r) => r.json())
      expect(restoreArticle.value.title).toBe('A')
      expect((await fetch(`${base}/api/store/articles/a1`).then((r) => r.json())).value.title).toBe('A')

      const learning = {
        practice: [{ at: '2026-01-01T00:00:00.000Z', kind: 'quiz', total: 10, correct: 8 }],
        mistakes: [{ id: 'vocab:w1', kind: 'vocab', at: '2026-01-01T00:00:00.000Z', count: 1, label: 'w1' }],
        readDone: [],
        writingHistory: [],
        retells: [],
        activity: [{ day: '2026-01-01', counts: { vocab: 3 } }],
        studyDays: [],
        sessions: [],
        studiedDays: [{ day: '2026-01-01', ids: ['w1'] }],
        skimmed: [],
        kindStats: {},
        answerEvents: [
          {
            at: '2026-01-01T00:00:00.000Z',
            day: '2026-01-01',
            articleId: 'a1',
            source: 'quiz',
            kind: 'cloze',
            cat: 'vocab',
            correct: true,
          },
        ],
      }
      const putLearning = await fetch(`${base}/api/store/learning`, {
        method: 'PUT',
        headers: json(),
        body: JSON.stringify(learning),
      })
      expect(putLearning.status).toBe(200)
      const learningGet = await fetch(`${base}/api/store/learning`).then((r) => r.json())
      expect(learningGet.value.practice).toHaveLength(1)
      expect(learningGet.value.activity[0].counts.vocab).toBe(3)
      expect(learningGet.value.answerEvents).toHaveLength(1)

      const rebuilt = await fetch(`${base}/api/store/learning/rebuild-derived`, {
        method: 'POST',
        headers: json(),
      }).then((r) => r.json())
      expect(rebuilt.ok).toBe(true)
      expect(rebuilt.value.answerEvents).toHaveLength(1)

      const partial = await fetch(`${base}/api/store/learning/partial`, {
        method: 'PUT',
        headers: json(),
        body: JSON.stringify({ practice: [] }),
      })
      expect(partial.status).toBe(200)
      const afterPartial = await fetch(`${base}/api/store/learning`).then((r) => r.json())
      expect(afterPartial.value.practice).toEqual([])
      expect(afterPartial.value.mistakes).toHaveLength(1)
      expect(afterPartial.value.studiedDays[0].ids).toEqual(['w1'])

      const migrateEmpty = await fetch(`${base}/api/store/learning/if-empty`, {
        method: 'PUT',
        headers: json(),
        body: JSON.stringify({ ...learning, practice: [] }),
      }).then((r) => r.json())
      expect(migrateEmpty.migrated).toBe(false)
      expect(migrateEmpty.value.practice).toEqual([])

      const dump = await fetch(`${base}/api/store/export`).then((r) => r.json())
      expect(dump.vocab.items).toHaveLength(1)
      expect(dump.articles[0].id).toBe('a1')
      expect(dump.learning.practice).toEqual([])

      const snapshots = await fetch(`${base}/api/store/learning/snapshots`).then((r) => r.json())
      expect(snapshots.snapshots.length).toBeGreaterThan(0)
      const snapId = snapshots.snapshots[0].id
      const snapDetail = await fetch(`${base}/api/store/learning/snapshots/${snapId}`).then((r) => r.json())
      expect(snapDetail.value.value.practice).toHaveLength(1)
      const restore = await fetch(`${base}/api/store/learning/snapshots/${snapId}/restore`, {
        method: 'POST',
        headers: json(),
      }).then((r) => r.json())
      expect(restore.ok).toBe(true)
      expect(restore.value.value.practice).toHaveLength(1)
      expect((await fetch(`${base}/api/store/learning`).then((r) => r.json())).value.practice).toHaveLength(1)

      const dbFile = await fetch(`${base}/api/store/db`)
      expect(dbFile.status).toBe(200)
      expect(dbFile.headers.get('content-type')).toContain('sqlite')
      const bytes = Buffer.from(await dbFile.arrayBuffer())
      expect(bytes.byteLength).toBeGreaterThan(0)
      // 下载的是 VACUUM INTO 出来的一致性快照，不是可能漏 WAL 的主库文件。
      const downloaded = join(mkdtempSync(join(tmpdir(), 'sa-download-')), 'xueba.db')
      writeFileSync(downloaded, bytes)
      const copy = new DatabaseSync(downloaded, { readOnly: true })
      expect(copy.prepare('SELECT COUNT(*) AS n FROM words').get().n).toBe(1)
      expect(copy.prepare('PRAGMA user_version').get().user_version).toBe(7)
      copy.close()

      const evil = await fetch(`${base}/api/store/vocab`, {
        method: 'PUT',
        headers: { ...json(), Origin: 'http://evil.test' },
        body: JSON.stringify(library),
      })
      expect(evil.status).toBe(403)
    } finally {
      await new Promise((r) => server.close(r))
      closeAllStores()
    }
  })

  it('fish 静态资源：列表 / 取图 / 防越界', async () => {
    const dist = mkdtempSync(join(tmpdir(), 'sa-dist-'))
    const pub = mkdtempSync(join(tmpdir(), 'sa-pub-'))
    const fish = mkdtempSync(join(tmpdir(), 'sa-fish-'))
    mkdirSync(join(dist, 'assets'), { recursive: true })
    writeFileSync(join(dist, 'index.html'), 'x')
    writeFileSync(join(fish, 'a.png'), 'PNGDATA')
    writeFileSync(join(fish, 'note.txt'), 'nope')
    const server = createServer(createRequestHandler({ distDir: dist, publicDir: pub, fishDir: fish }))
    await new Promise((r) => server.listen(0, r))
    const port = server.address().port
    try {
      const list = await fetch(`http://127.0.0.1:${port}/fish/manifest.json`).then((r) => r.json())
      expect(list).toEqual(['a.png'])
      const img = await fetch(`http://127.0.0.1:${port}/fish/a.png`)
      expect(img.status).toBe(200)
      expect(img.headers.get('content-type')).toContain('image/png')
      expect(await img.text()).toBe('PNGDATA')
      const bad = await fetch(`http://127.0.0.1:${port}/fish/..%2Fsecret`)
      expect(bad.status).toBe(400)
      const miss = await fetch(`http://127.0.0.1:${port}/fish/zzz.png`)
      expect(miss.status).toBe(404)
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

describe('httpApp：路由回落 + 静态 gzip', () => {
  /** 用 node:http 直连（fetch 会自动解压，断言不到 Content-Encoding）。 */
  const rawGet = (port, path, headers = {}) =>
    new Promise((resolve, reject) => {
      const req = request({ host: '127.0.0.1', port, path, headers }, (res) => {
        const chunks = []
        res.on('data', (c) => chunks.push(c))
        res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }))
      })
      req.on('error', reject)
      req.end()
    })

  const setup = () => {
    const dist = mkdtempSync(join(tmpdir(), 'sa-route-'))
    const pub = mkdtempSync(join(tmpdir(), 'sa-pub2-'))
    mkdirSync(join(dist, 'assets'), { recursive: true })
    writeFileSync(join(dist, 'index.html'), '<!doctype html><title>首页</title>')
    // 单入口 SPA：不再有 reader.html
    // 大于 GZIP_MIN(1KB) 才能触发压缩
    writeFileSync(join(dist, 'assets', 'app.js'), `/* ${'x'.repeat(4096)} */\nconsole.log(1)\n`)
    return { dist, pub }
  }

  it('/reader、/reader/** 与旧 /reader.html 都回落到单入口 index.html', async () => {
    const { dist, pub } = setup()
    const server = createServer(createRequestHandler({ distDir: dist, publicDir: pub }))
    await new Promise((r) => server.listen(0, r))
    const port = server.address().port
    try {
      for (const p of ['/reader', '/reader/a/b%3A005', '/reader/a/b%3A005/p/intensive', '/reader/p/plan', '/reader.html']) {
        const r = await rawGet(port, p)
        expect(r.status, p).toBe(200)
        expect(r.body.toString(), p).toContain('首页')
      }
      const home = await rawGet(port, '/a/whatever')
      expect(home.body.toString()).toContain('首页')
      // 带扩展名的缺失资源仍然 404，别回落成 HTML（否则浏览器把 HTML 当 JS 解析）
      expect((await rawGet(port, '/assets/missing.js')).status).toBe(404)
    } finally {
      await new Promise((r) => server.close(r))
    }
  })

  it('文本资源按 Accept-Encoding 决定是否 gzip，体积真的变小且内容一致', async () => {
    const { dist, pub } = setup()
    const server = createServer(createRequestHandler({ distDir: dist, publicDir: pub }))
    await new Promise((r) => server.listen(0, r))
    const port = server.address().port
    try {
      const plain = await rawGet(port, '/assets/app.js')
      const gz = await rawGet(port, '/assets/app.js', { 'accept-encoding': 'gzip' })
      expect(plain.headers['content-encoding']).toBeUndefined()
      expect(gz.headers['content-encoding']).toBe('gzip')
      expect(gz.headers['vary']).toContain('Accept-Encoding')
      expect(gz.body.length).toBeLessThan(plain.body.length)
      // 解压后必须和明文完全一致
      expect(gunzipSync(gz.body).equals(plain.body)).toBe(true)
    } finally {
      await new Promise((r) => server.close(r))
    }
  })
})
