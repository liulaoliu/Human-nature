import { createReadStream, existsSync, mkdirSync, statSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { gzipSync } from 'node:zlib'
import { contentType, safeJoin, stripLeadingSlashes } from './util.js'
import { handleTts, resolveTtsCacheDir } from '../tools/tts-core.mjs'
import { handleAiApi } from '../tools/ai-core.mjs'
import { handleStoreApi } from './storeApi.js'
import { allowLocalRequest } from './sameOrigin.js'

const DATA_FILES = new Set([
  'articles.json',
  'shadowing-state.json',
  'ecdict.tsv',
  'ecdict-forms.tsv',
  'ecdict-near.tsv',
  'mwld.tsv',
])
const FISH_IMG = /\.(png|jpe?g|webp|avif)$/i
const FISH_MAX = 600 * 1024

/** 只收轻量图（排除动画 gif / 大文件），避免装饰图吃 CPU。 */
function listFish(dir) {
  let names = []
  try {
    names = readdirSync(dir).filter((f) => FISH_IMG.test(f))
  } catch {
    return []
  }
  const sizeOf = (f) => {
    try {
      return statSync(join(dir, f)).size
    } catch {
      return Infinity
    }
  }
  const light = names.filter((f) => sizeOf(f) <= FISH_MAX)
  return (light.length ? light : names).sort()
}

function sendJson(res, code, obj) {
  res.statusCode = code
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.end(JSON.stringify(obj))
}

/**
 * 能压的文本类型。图片 / 音频 / woff2 本来就被压过，再 gzip 只会更大。
 *
 * 为什么值得做：`dist/assets/reader-*.js` 是 637KB，明文发一次就是 637KB；
 * gzip 后 214KB（省 66%）。这在局域网 / 手机上差别很直观，本机回环也能省下
 * 浏览器的解析时间。
 */
const GZIP_EXT = /\.(js|mjs|css|html?|json|tsv|svg|txt|map)$/i
/** 小于这个体积压了反而亏（gzip 头就 20 字节）。 */
const GZIP_MIN = 1024 // 1KB
/**
 * 压缩结果缓存：键 = 绝对路径，值 = { mtimeMs, size, buf }。
 *
 * `dist/assets/*` 带 content hash，同一路径的内容永远不变，缓存命中率接近 100%；
 * `articles.json` / `*.tsv` 这类可变文件靠 (mtime, size) 失效。
 */
const gzipCache = new Map()

function gzipFor(file, st) {
  const hit = gzipCache.get(file)
  if (hit && hit.mtimeMs === st.mtimeMs && hit.size === st.size) return hit.buf
  // 同步压缩：单次 637KB 约 10–20ms，而且只在这个文件第一次被请求时发生。
  // 比起「每个请求都发 637KB」，这个代价是划算的；真要再快该用 brotli 预算缓存。
  const buf = gzipSync(readFileSync(file), { level: 6 })
  gzipCache.set(file, { mtimeMs: st.mtimeMs, size: st.size, buf })
  return buf
}

function serveFile(req, res, file, { head = false, cache = false } = {}) {
  const st = statSync(file)
  res.statusCode = 200
  res.setHeader('Content-Type', contentType(file))
  res.setHeader('Cache-Control', cache ? 'public, max-age=31536000, immutable' : 'no-cache')
  const acceptsGzip = String(req?.headers?.['accept-encoding'] || '').includes('gzip')
  if (acceptsGzip && GZIP_EXT.test(file) && st.size >= GZIP_MIN) {
    const buf = gzipFor(file, st)
    res.setHeader('Vary', 'Accept-Encoding')
    res.setHeader('Content-Encoding', 'gzip')
    res.setHeader('Content-Length', buf.length)
    if (head) {
      res.end()
      return
    }
    res.end(buf)
    return
  }
  res.setHeader('Content-Length', st.size)
  if (head) {
    res.end()
    return
  }
  createReadStream(file).pipe(res)
}

/** 单入口 SPA：所有前端路由都回落到同一份 index.html（/reader/** 与旧 /reader.html 也一样）。 */
function isSpaFallback(pathname) {
  // 带扩展名的缺失资源仍然 404（否则浏览器把 HTML 当 JS 解析）；
  // 只有旧入口 /reader.html 是个例外：它没有对应文件，但要能打开阅读页。
  return !/\.[a-zA-Z0-9]+$/.test(pathname) || pathname === '/reader.html'
}

/**
 * 请求处理器（可单测）：
 *  - GET  /api/status            → { ok, pid, uptime, time }
 *  - POST /__state               → 写 public/shadowing-state.json（「存入项目」）
 *  - articles.json / shadowing-state.json 优先 public（重新生成不必 rebuild）
 *  - 其余静态文件来自 dist/
 */
export function createRequestHandler({ distDir, publicDir, fishDir, startedAt = Date.now(), dbPath } = {}) {
  return (req, res) => {
    const url = req.url || '/'
    const pathname = url.split('?')[0]

    // 有副作用 / 会花钱 / 会写盘的入口统一挡跨站（store 内部还会再校验一次，dev 插件也直接复用）
    const guarded =
      pathname.startsWith('/api/store') ||
      pathname.startsWith('/api/ai/') ||
      pathname.startsWith('/api/tts') ||
      pathname === '/__state'
    if (guarded && !allowLocalRequest(req)) {
      res.statusCode = 403
      res.setHeader('Content-Type', 'text/plain; charset=utf-8')
      res.end('跨站请求被拒绝')
      return
    }

    if (pathname === '/api/status') {
      sendJson(res, 200, {
        ok: true,
        pid: process.pid,
        uptime: (Date.now() - startedAt) / 1000,
        time: new Date().toISOString(),
      })
      return
    }

    // SQLite 主存储：/api/store/*（词库 / 文章 / 导出；没有 node:sqlite 时前端回退 IndexedDB）
    if (pathname.startsWith('/api/store')) {
      handleStoreApi(req, res, { root: join(distDir, '..'), dbPath }).catch((e) => {
        if (!res.headersSent) {
          res.statusCode = 500
          res.setHeader('Content-Type', 'application/json; charset=utf-8')
          res.end(JSON.stringify({ ok: false, error: e instanceof Error ? e.message : 'store error' }))
        }
      })
      return
    }

    // AI 一键跑批：/api/ai/status · /api/ai/run（key 只在服务端读取，绝不回传浏览器）
    if (pathname.startsWith('/api/ai/')) {
      handleAiApi(req, res, { root: join(distDir, '..') })
      return
    }

    // TTS：/api/tts（音频）、/api/tts/words（逐词时间戳）、/api/tts/engines（可用引擎）
    if (pathname.startsWith('/api/tts')) {
      handleTts(req, res, { cacheDir: resolveTtsCacheDir(dirname(publicDir)) }).catch(() => {
        if (!res.headersSent) {
          res.statusCode = 500
          res.end('tts error')
        }
      })
      return
    }

    // 静态鱼素材：GET /fish（文件名列表）· GET /fish/<name>
    if (fishDir && (pathname === '/fish' || pathname === '/fish/manifest.json')) {
      sendJson(res, 200, listFish(fishDir))
      return
    }
    if (fishDir && pathname.startsWith('/fish/')) {
      let name = ''
      try {
        name = decodeURIComponent(pathname.slice('/fish/'.length))
      } catch {
        res.statusCode = 400
        res.end('bad name')
        return
      }
      if (!name || name.includes('..') || name.includes('/') || name.includes('\\') || !FISH_IMG.test(name)) {
        res.statusCode = 400
        res.end('bad name')
        return
      }
      const file = join(fishDir, name)
      if (existsSync(file) && statSync(file).isFile()) {
        serveFile(req, res, file, { head: req.method === 'HEAD', cache: true })
        return
      }
      res.statusCode = 404
      res.end('not found')
      return
    }

    if (pathname === '/__state' && req.method === 'POST') {
      let body = ''
      req.on('data', (chunk) => {
        body += chunk
        if (body.length > 8 * 1024 * 1024) req.destroy()
      })
      req.on('end', () => {
        try {
          JSON.parse(body)
          mkdirSync(publicDir, { recursive: true })
          writeFileSync(join(publicDir, 'shadowing-state.json'), body, 'utf8')
          sendJson(res, 200, { ok: true })
        } catch {
          sendJson(res, 400, { ok: false })
        }
      })
      return
    }

    const name = stripLeadingSlashes(pathname)
    if (DATA_FILES.has(name) && existsSync(join(publicDir, name))) {
      serveFile(req, res, join(publicDir, name), { head: req.method === 'HEAD' })
      return
    }

    let file = safeJoin(distDir, pathname)
    if (file === null) {
      res.statusCode = 400
      res.end('bad path')
      return
    }
    if (pathname === '/' || pathname === '') file = join(distDir, 'index.html')
    if (existsSync(file) && statSync(file).isDirectory()) file = join(file, 'index.html')
    if (!existsSync(file)) {
      if (isSpaFallback(pathname)) {
        // 单入口 SPA：/reader、/reader/a/<slug>/p/<panel>、旧 /reader.html
        // 磁盘上都不存在，统一交给 index.html，由前端 Router 决定渲染哪棵树。
        const target = join(distDir, 'index.html')
        if (existsSync(target)) {
          serveFile(req, res, target)
          return
        }
      }
      res.statusCode = 404
      res.setHeader('Content-Type', 'text/plain; charset=utf-8')
      res.end('not found')
      return
    }
    const cache = pathname.includes('/assets/')
    serveFile(req, res, file, { head: req.method === 'HEAD', cache })
  }
}

/** 读端口：命令行/env > config.json > 5173（5173 是原 dev 端口，保指数库 origin 不变）。 */
export function loadPort(root, argPort) {
  if (argPort && /^\d+$/.test(argPort)) return Number(argPort)
  if (process.env.PORT && /^\d+$/.test(process.env.PORT)) return Number(process.env.PORT)
  try {
    const c = JSON.parse(readFileSync(join(root, 'config.json'), 'utf8'))
    if (c.port) return Number(c.port)
  } catch {
    // ignore
  }
  return 5173
}
