import { createReadStream, existsSync, mkdirSync, statSync, writeFileSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { contentType, safeJoin, stripLeadingSlashes } from './util.js'

const DATA_FILES = new Set(['articles.json', 'shadowing-state.json'])

function sendJson(res, code, obj) {
  res.statusCode = code
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.end(JSON.stringify(obj))
}

function serveFile(res, file, { head = false, cache = false } = {}) {
  const st = statSync(file)
  res.statusCode = 200
  res.setHeader('Content-Type', contentType(file))
  res.setHeader('Content-Length', st.size)
  res.setHeader('Cache-Control', cache ? 'public, max-age=31536000, immutable' : 'no-cache')
  if (head) {
    res.end()
    return
  }
  createReadStream(file).pipe(res)
}

/**
 * 请求处理器（可单测）：
 *  - GET  /api/status            → { ok, pid, uptime, time }
 *  - POST /__state               → 写 public/shadowing-state.json（「存入项目」）
 *  - articles.json / shadowing-state.json 优先 public（重新生成不必 rebuild）
 *  - 其余静态文件来自 dist/
 */
export function createRequestHandler({ distDir, publicDir, startedAt = Date.now() }) {
  return (req, res) => {
    const url = req.url || '/'
    const pathname = url.split('?')[0]

    if (pathname === '/api/status') {
      sendJson(res, 200, {
        ok: true,
        pid: process.pid,
        uptime: (Date.now() - startedAt) / 1000,
        time: new Date().toISOString(),
      })
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
      serveFile(res, join(publicDir, name), { head: req.method === 'HEAD' })
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
      if (!/\.[a-zA-Z0-9]+$/.test(pathname)) {
        const idx = join(distDir, 'index.html')
        if (existsSync(idx)) {
          serveFile(res, idx)
          return
        }
      }
      res.statusCode = 404
      res.setHeader('Content-Type', 'text/plain; charset=utf-8')
      res.end('not found')
      return
    }
    const cache = pathname.includes('/assets/')
    serveFile(res, file, { head: req.method === 'HEAD', cache })
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
