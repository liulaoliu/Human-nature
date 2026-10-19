import { randomUUID } from 'node:crypto'
import { chmodSync, createReadStream, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { resolveDbPath, openStore, SCHEMA_VERSION } from './sqliteStore.js'

const MAX_BODY = 64 * 1024 * 1024

function sendJson(res, code, obj, headers = {}) {
  res.statusCode = code
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.setHeader('Cache-Control', 'no-store')
  for (const [k, v] of Object.entries(headers)) res.setHeader(k, v)
  res.end(JSON.stringify(obj))
}

function fail(res, code, message) {
  sendJson(res, code, { ok: false, error: message })
}

function readBody(req, limit = MAX_BODY) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    let tooLarge = false
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > limit) {
        tooLarge = true
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      if (tooLarge) reject(new Error('请求体太大'))
      else resolve(Buffer.concat(chunks).toString('utf8'))
    })
    req.on('error', reject)
  })
}

async function readJson(req) {
  const raw = await readBody(req)
  try {
    return JSON.parse(raw)
  } catch {
    throw new Error('请求体不是合法 JSON')
  }
}

/**
 * 写接口必须同源：本地服务没有登录态，任何网页都能往 127.0.0.1 POST。
 * 校验 Origin（有就必填且 Host 一致）挡住浏览器里的跨站写入；curl / 脚本不带 Origin 仍可用。
 */
function sameOrigin(req) {
  const origin = req.headers.origin
  if (!origin) return true
  try {
    return new URL(origin).host === (req.headers.host || '')
  } catch {
    return false
  }
}

function decodePart(s) {
  try {
    return decodeURIComponent(s)
  } catch {
    return ''
  }
}

/**
 * `/api/store/*` 路由（dev 的 Vite 插件和 static 的 httpApp 共用）。
 * 所有数据都是 JSON；音频等二进制留给下一阶段。
 */
export async function handleStoreApi(req, res, { root, dbPath } = {}) {
  const url = new URL(req.url || '/', 'http://localhost')
  const path = url.pathname.replace(/^\/api\/store/, '') || '/'
  const method = req.method || 'GET'

  if (method !== 'GET' && method !== 'HEAD' && !sameOrigin(req)) {
    fail(res, 403, '跨站请求被拒绝')
    return
  }

  const store = openStore(dbPath || resolveDbPath(root || process.cwd()))
  if (!store) {
    sendJson(res, 503, { ok: false, error: 'SQLite 不可用（需要 Node 22.5+）' })
    return
  }

  try {
    if (path === '/health') {
      sendJson(res, 200, {
        ok: true,
        engine: 'sqlite',
        version: SCHEMA_VERSION,
        path: store.path,
      })
      return
    }

    if (path === '/vocab' && method === 'GET') {
      sendJson(res, 200, { ok: true, value: store.loadVocab() })
      return
    }

    if (path === '/vocab' && method === 'PUT') {
      store.saveVocab(await readJson(req))
      sendJson(res, 200, { ok: true })
      return
    }

    if (path === '/vocab/if-empty' && method === 'PUT') {
      sendJson(res, 200, { ok: true, ...store.migrateVocab(await readJson(req)) })
      return
    }

    if (path === '/vocab' && method === 'DELETE') {
      store.clearVocab()
      sendJson(res, 200, { ok: true })
      return
    }

    if (path === '/vocab/prev' && method === 'GET') {
      sendJson(res, 200, { ok: true, value: store.loadPrev() })
      return
    }

    if (path === '/vocab/snapshots' && method === 'GET') {
      sendJson(res, 200, { ok: true, snapshots: store.listSnapshots() })
      return
    }

    const snap = path.match(/^\/vocab\/snapshots\/(.+)$/)
    if (snap && method === 'GET') {
      sendJson(res, 200, { ok: true, value: store.loadSnapshot(decodePart(snap[1])) })
      return
    }

    if (path === '/articles' && method === 'GET') {
      sendJson(res, 200, { ok: true, articles: store.listArticles() })
      return
    }

    const article = path.match(/^\/articles\/(.+)$/)
    if (article) {
      const id = decodePart(article[1])
      if (!id) {
        fail(res, 400, '缺少文章 id')
        return
      }
      if (method === 'GET') {
        sendJson(res, 200, { ok: true, value: store.getArticle(id) })
        return
      }
      if (method === 'PUT') {
        const value = await readJson(req)
        if (!value || typeof value !== 'object' || value.id !== id) {
          fail(res, 400, '文章 id 不一致')
          return
        }
        store.saveArticle(value)
        sendJson(res, 200, { ok: true })
        return
      }
      if (method === 'DELETE') {
        store.removeArticle(id)
        sendJson(res, 200, { ok: true })
        return
      }
    }

    if (path === '/learning' && method === 'GET') {
      sendJson(res, 200, { ok: true, value: store.loadLearning() })
      return
    }

    if (path === '/learning' && method === 'PUT') {
      store.saveLearning(await readJson(req))
      sendJson(res, 200, { ok: true })
      return
    }

    if (path === '/learning/partial' && method === 'PUT') {
      store.saveLearningPartial(await readJson(req))
      sendJson(res, 200, { ok: true })
      return
    }

    if (path === '/learning/if-empty' && method === 'PUT') {
      sendJson(res, 200, { ok: true, ...store.migrateLearning(await readJson(req)) })
      return
    }

    if (path === '/export' && method === 'GET') {
      const download = url.searchParams.get('download') === '1'
      sendJson(
        res,
        200,
        store.exportAll(),
        download
          ? { 'Content-Disposition': `attachment; filename="xueba-export-${new Date().toISOString().slice(0, 10)}.json"` }
          : {},
      )
      return
    }

    if (path === '/db' && method === 'GET') {
      // 生成一致性快照再下载；直接 stream 主库会漏掉还在 WAL 里的最新提交。
      const file = join(tmpdir(), `xueba-${randomUUID()}.db`)
      try {
        store.backupTo(file)
        try {
          chmodSync(file, 0o600)
        } catch {
          // Windows 忽略权限位
        }
        const st = statSync(file)
        res.statusCode = 200
        res.setHeader('Content-Type', 'application/vnd.sqlite3')
        res.setHeader('Content-Length', st.size)
        res.setHeader('Cache-Control', 'no-store')
        res.setHeader(
          'Content-Disposition',
          `attachment; filename="xueba-${new Date().toISOString().slice(0, 10)}.db"`,
        )
        const stream = createReadStream(file)
        const cleanup = () => rmSync(file, { force: true })
        stream.once('close', cleanup)
        stream.once('error', cleanup)
        stream.pipe(res)
      } catch (e) {
        rmSync(file, { force: true })
        throw e
      }
      return
    }

    fail(res, 404, '接口不存在')
  } catch (e) {
    fail(res, 400, e instanceof Error ? e.message : '存储操作失败')
  }
}
