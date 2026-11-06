import { describe, it, expect } from 'vitest'
import { createServer, request } from 'node:http'
import type { IncomingHttpHeaders, IncomingMessage, Server } from 'node:http'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { gunzipSync } from 'node:zlib'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { contentType, safeJoin, stripLeadingSlashes } from './util.ts'
import { restartDecision } from './watchdog.ts'
import { getPort } from './status.ts'
import { createRequestHandler } from './httpApp.ts'
import { SCHEMA_VERSION } from './sqliteSchema.ts'
import { resolveChild, loadMode } from './mode.ts'
import { closeAllStores } from './sqliteStore.ts'
import { allowLocalRequest } from './sameOrigin.ts'
import { PRIVATE_FS_DENY } from './privatePaths.ts'
import { localDayKey } from './localDate.ts'

const require = createRequire(import.meta.url)
const { DatabaseSync } = require('node:sqlite')

/* ------------------------------------------------------------------ *
 * 请求 / 响应边界的形状声明
 *
 * 服务端 store 层刻意把持久化数据当 `unknown`（见 sqliteLearning.ts 顶部
 * 的职责说明），而 `Response.json()` 在 @types/node 里也返回 `unknown`。
 * 所以在这里用 interface 描述「用例真正读到的字段」，解析处只做一次断言
 * —— 断言里的字段名都照 server/storeApi.ts 实际发出的 JSON 写。
 * ------------------------------------------------------------------ */

/** GET /api/status */
interface StatusResponse {
  ok: boolean
  pid: number
  uptime: number
  time: string
}

/** GET /api/store/health（故意不声明库文件绝对路径：用例要断言它不存在） */
interface StoreHealthResponse {
  ok: boolean
  engine: string
  version: number
  path?: string
}

/** 词库数据：PUT 的请求体，也是 /vocab 响应里的 value */
interface VocabLibrary {
  items: { id: string; word: string }[]
  stats: Record<string, unknown>
}

/** GET /api/store/vocab */
interface VocabResponse {
  ok: boolean
  value: VocabLibrary
  updatedAt: string
  count: number
}

/** PUT /api/store/vocab 的 200 / 409 响应（409 额外带库里的最新版本与条数） */
interface VocabWriteResponse {
  ok: boolean
  updatedAt: string
  count: number
}

/** GET /api/store/vocab/snapshots */
interface VocabSnapshotsResponse {
  ok: boolean
  snapshots: { at: string; count: number }[]
}

/** 文章：用例构造的请求体，以及 GET /api/store/articles 的列表项 */
interface ArticleFixture {
  id: string
  title: string
  text: string
  paragraphs: unknown[]
  sentences: unknown[]
  sourceKey: string | null
  updatedAt: string
}

interface ArticlesResponse {
  ok: boolean
  articles: ArticleFixture[]
}

/** 学习数据：用例构造的请求体 */
interface LearningFixture {
  practice: { at: string; kind: string; total: number; correct: number }[]
  mistakes: { id: string; kind: string; at: string; count: number; label: string }[]
  readDone: unknown[]
  writingHistory: unknown[]
  retells: unknown[]
  activity: { day: string; counts: Record<string, number> }[]
  studyDays: unknown[]
  sessions: unknown[]
  studiedDays: { day: string; ids: string[] }[]
  skimmed: unknown[]
  kindStats: Record<string, unknown>
  answerEvents: {
    at: string
    day: string
    articleId: string
    source: string
    kind: string
    cat: string
    correct: boolean
  }[]
}

/** 读回来的学习数据：只声明用例断言到的部分（其余字段由前端守卫收窄） */
interface LearningPayload {
  practice: unknown[]
  mistakes: unknown[]
  studiedDays: { day: string; ids: string[] }[]
  activity: { day: string; counts: Record<string, number> }[]
  answerEvents: unknown[]
}

/** GET /learning、POST /learning/rebuild-derived */
interface LearningResponse {
  ok: boolean
  value: LearningPayload
}

/** PUT /learning/if-empty（migrated=false 表示库里已有数据，没覆盖） */
interface LearningMigrateResponse {
  ok: boolean
  migrated: boolean
  value: LearningPayload
}

/** GET /api/store/export */
interface StoreExportResponse {
  format: string
  version: number
  exportedAt: string
  vocab: VocabLibrary
  articles: ArticleFixture[]
  learning: LearningPayload
}

/** node:http 直连拿到的原始响应（fetch 会自动解压，断言不到 Content-Encoding） */
interface RawResponse {
  status: number | undefined
  headers: IncomingHttpHeaders
  body: Buffer
}

/** 只带请求头的「最小请求」：allowLocalRequest 只读 req.headers。 */
const withHeaders = (headers: Record<string, string>): IncomingMessage =>
  ({ headers } as unknown as IncomingMessage)

/** 起服务并等 listening。 */
const listen = (server: Server, port = 0, host?: string): Promise<void> =>
  new Promise<void>((resolve) => {
    server.listen(port, host, () => resolve())
  })

/** listen 之后 address() 一定不是 null / 字符串；用运行期检查代替断言。 */
const portOf = (server: Server): number => {
  const addr = server.address()
  if (addr === null || typeof addr === 'string') throw new Error('server 没有监听 TCP 端口')
  return addr.port
}

/** HTTP 响应解析的唯一断言点：json() 是 unknown，形状由上面的 interface 给出。 */
const fetchJson = async <T>(url: string, init?: RequestInit): Promise<T> => {
  const res = await fetch(url, init)
  return (await res.json()) as T
}

/** 写接口的 JSON 头；可再叠 Origin / X-Vocab-Base 等。 */
const jsonHeaders = (init: Record<string, string> = {}): Record<string, string> => ({
  'Content-Type': 'application/json',
  ...init,
})

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
  it('stripLeadingSlashes 去掉开头斜杠（/ 与 \\ 都算）', () => {
    expect(stripLeadingSlashes('/a/b')).toBe('a/b')
    expect(stripLeadingSlashes('\\\\server\\\\share')).toBe('server\\\\share')
    expect(stripLeadingSlashes('//x')).toBe('x')
    expect(stripLeadingSlashes('a/b')).toBe('a/b')
    expect(stripLeadingSlashes('')).toBe('')
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
    expect(allowLocalRequest(withHeaders({ host: 'localhost:5173', origin: 'http://localhost:5173' }))).toBe(true)
    expect(allowLocalRequest(withHeaders({ host: 'localhost:5173', origin: 'http://evil.test' }))).toBe(false)
    expect(allowLocalRequest(withHeaders({ host: 'localhost:5173', 'sec-fetch-site': 'cross-site' }))).toBe(false)
    expect(allowLocalRequest(withHeaders({ host: 'localhost:5173' }))).toBe(true)
  })

  it('DNS 重绑定：Host 和 Origin 都是 evil.test 也拒绝；无 Origin 的 evil Host 同样拒绝', () => {
    expect(allowLocalRequest(withHeaders({ host: 'evil.test:5173', origin: 'http://evil.test:5173' }))).toBe(false)
    // 浏览器同源 GET 通常不带 Origin，只有 Host —— 这正是重绑定页读库的路径。
    expect(allowLocalRequest(withHeaders({ host: 'evil.test:5173' }))).toBe(false)
    expect(allowLocalRequest(withHeaders({ host: '127.0.0.1:5173', origin: 'http://127.0.0.1:5173' }))).toBe(true)
    expect(allowLocalRequest(withHeaders({ host: '[::1]:5173', origin: 'http://[::1]:5173' }))).toBe(true)
  })
})

describe('dev server 私密文件拒绝列表', () => {
  it('config.local.json / .env / 证书 / data 都在 deny 里', () => {
    expect(PRIVATE_FS_DENY).toEqual(
      expect.arrayContaining(['**/config.local.json', '**/.env', '**/.env.*', '**/*.{crt,pem}', '**/*.key', '**/data/**']),
    )
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
    await listen(server)
    const port = portOf(server)
    try {
      const st = await fetchJson<StatusResponse>(`http://127.0.0.1:${port}/api/status`)
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
    await listen(server, 0, '127.0.0.1')
    const base = `http://127.0.0.1:${portOf(server)}`
    try {
      const health = await fetchJson<StoreHealthResponse>(`${base}/api/store/health`)
      expect(health).toMatchObject({ ok: true, engine: 'sqlite' })
      // 不向页面泄露数据库绝对路径（截图/日志分享时）
      expect(health.path).toBeUndefined()

      const library: VocabLibrary = { items: [{ id: 'w1', word: 'test' }], stats: {} }
      const putVocab = await fetch(`${base}/api/store/vocab`, {
        method: 'PUT',
        headers: jsonHeaders(),
        body: JSON.stringify(library),
      })
      expect(putVocab.status).toBe(200)
      const got = await fetchJson<VocabResponse>(`${base}/api/store/vocab`)
      expect(got.value.items).toHaveLength(1)
      expect(got.updatedAt).toBeTruthy()

      // 乐观锁：带着过期版本号写 → 409，库不动
      const stale = await fetch(`${base}/api/store/vocab`, {
        method: 'PUT',
        headers: jsonHeaders({ 'X-Vocab-Base': '2000-01-01T00:00:00.000Z' }),
        body: JSON.stringify({ items: [], stats: {} }),
      })
      expect(stale.status).toBe(409)
      expect(((await stale.json()) as VocabWriteResponse).count).toBe(1)
      expect((await fetchJson<VocabResponse>(`${base}/api/store/vocab`)).value.items).toHaveLength(1)

      // 带着最新版本号写 → 放行
      const fresh = await fetch(`${base}/api/store/vocab`, {
        method: 'PUT',
        headers: jsonHeaders({ 'X-Vocab-Base': got.updatedAt }),
        body: JSON.stringify({ items: [...library.items, { id: 'w2', word: 'more' }], stats: {} }),
      })
      expect(fresh.status).toBe(200)
      expect(((await fresh.json()) as VocabWriteResponse).updatedAt).not.toBe(got.updatedAt)

      // 还原成原来的内容，后面的「相同内容不重复写」才测得准（不带 base = 强制写）
      await fetch(`${base}/api/store/vocab`, { method: 'PUT', headers: jsonHeaders(), body: JSON.stringify(library) })

      // 相同内容重复 PUT：不再写快照 / 重建派生表
      const snapsBefore = (await fetchJson<VocabSnapshotsResponse>(`${base}/api/store/vocab/snapshots`)).snapshots.length
      await fetch(`${base}/api/store/vocab`, {
        method: 'PUT',
        headers: jsonHeaders(),
        body: JSON.stringify(library),
      })
      const snapsAfter = (await fetchJson<VocabSnapshotsResponse>(`${base}/api/store/vocab/snapshots`)).snapshots.length
      expect(snapsAfter).toBe(snapsBefore)

      const article: ArticleFixture = {
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
        headers: jsonHeaders(),
        body: JSON.stringify(article),
      })
      expect(putArticle.status).toBe(200)
      expect((await fetchJson<ArticlesResponse>(`${base}/api/store/articles`)).articles[0]?.id).toBe('a1')

      const putArticle2 = await fetch(`${base}/api/store/articles/a1`, {
        method: 'PUT',
        headers: jsonHeaders(),
        body: JSON.stringify({ ...article, title: 'A2', updatedAt: '2026-01-02T00:00:00.000Z' }),
      })
      expect(putArticle2.status).toBe(200)

      const learning: LearningFixture = {
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
        headers: jsonHeaders(),
        body: JSON.stringify(learning),
      })
      expect(putLearning.status).toBe(200)
      const learningGet = await fetchJson<LearningResponse>(`${base}/api/store/learning`)
      expect(learningGet.value.practice).toHaveLength(1)
      expect(learningGet.value.activity[0]?.counts.vocab).toBe(3)
      expect(learningGet.value.answerEvents).toHaveLength(1)

      const rebuilt = await fetchJson<LearningResponse>(`${base}/api/store/learning/rebuild-derived`, {
        method: 'POST',
        headers: jsonHeaders(),
      })
      expect(rebuilt.ok).toBe(true)
      expect(rebuilt.value.answerEvents).toHaveLength(1)

      const partial = await fetch(`${base}/api/store/learning/partial`, {
        method: 'PUT',
        headers: jsonHeaders(),
        body: JSON.stringify({ practice: [] }),
      })
      expect(partial.status).toBe(200)
      const afterPartial = await fetchJson<LearningResponse>(`${base}/api/store/learning`)
      expect(afterPartial.value.practice).toEqual([])
      expect(afterPartial.value.mistakes).toHaveLength(1)
      expect(afterPartial.value.studiedDays[0]?.ids).toEqual(['w1'])

      const migrateEmpty = await fetchJson<LearningMigrateResponse>(`${base}/api/store/learning/if-empty`, {
        method: 'PUT',
        headers: jsonHeaders(),
        body: JSON.stringify({ ...learning, practice: [] }),
      })
      expect(migrateEmpty.migrated).toBe(false)
      expect(migrateEmpty.value.practice).toEqual([])

      const dump = await fetchJson<StoreExportResponse>(`${base}/api/store/export`)
      expect(dump.vocab.items).toHaveLength(1)
      expect(dump.articles[0]?.id).toBe('a1')
      expect(dump.learning.practice).toEqual([])

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
      expect(copy.prepare('PRAGMA user_version').get().user_version).toBe(SCHEMA_VERSION)
      copy.close()

      const evil = await fetch(`${base}/api/store/vocab`, {
        method: 'PUT',
        headers: jsonHeaders({ Origin: 'http://evil.test' }),
        body: JSON.stringify(library),
      })
      expect(evil.status).toBe(403)

      // DNS 重绑定：Host 与 Origin 都是 evil.test（两者相等），仍必须 403。
      const rebound = await new Promise<number | undefined>((resolve, reject) => {
        const req = request(
          {
            host: '127.0.0.1',
            port: portOf(server),
            path: '/api/store/vocab',
            method: 'GET',
            headers: { Host: `evil.test:${portOf(server)}`, Origin: `http://evil.test:${portOf(server)}` },
          },
          (res) => {
            res.resume()
            res.on('end', () => resolve(res.statusCode))
          },
        )
        req.on('error', reject)
        req.end()
      })
      expect(rebound).toBe(403)
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
    await listen(server)
    const port = portOf(server)
    try {
      const list = await fetchJson<string[]>(`http://127.0.0.1:${port}/fish/manifest.json`)
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
    expect(c.args[0]?.endsWith('appServer.ts')).toBe(true)
  })
  it('dev 模式优先 vite（装了依赖时）', () => {
    const c = resolveChild(resolve('.'), 'dev')
    const entry = c.args[0] ?? ''
    expect(entry.includes('vite') || entry.endsWith('appServer.ts')).toBe(true)
  })
  it('默认模式是 dev', () => {
    expect(loadMode(resolve('.'))).toBe('dev')
  })
})

describe('httpApp：路由回落 + 静态 gzip', () => {
  /** 用 node:http 直连（fetch 会自动解压，断言不到 Content-Encoding）。 */
  const rawGet = (port: number, path: string, headers: Record<string, string> = {}): Promise<RawResponse> =>
    new Promise<RawResponse>((resolve, reject) => {
      const req = request({ host: '127.0.0.1', port, path, headers }, (res) => {
        const chunks: Buffer[] = []
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
    await listen(server)
    const port = portOf(server)
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
    await listen(server)
    const port = portOf(server)
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
