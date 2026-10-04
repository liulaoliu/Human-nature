import { createReadStream, existsSync, readdirSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'

/**
 * dev-only 静态服务：把 `assets/imgs/fish/` 里的图片当**静态资源**提供。
 *
 *   GET /fish                → 目录里的图片文件名数组（JSON）
 *   GET /fish/<name>         → 直接返回图片文件
 *
 * 这样 fish 图**不进 bundle**（不再用 import.meta.glob），dev 也能拿到。
 * 静态模式（appServer/httpApp.js）里有对应实现。
 *
 * 放 .mjs 是因为要用 node:fs，而前端 tsconfig 不装 @types/node。
 */
const IMG = /\.(png|jpe?g|webp|avif)$/i
/** 只收轻量的图：排除动画 gif（吃 CPU）、排除大文件（解码/内存） */
const MAX_BYTES = 600 * 1024

function listFish(dir) {
  let names = []
  try {
    names = readdirSync(dir).filter((f) => IMG.test(f))
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
  const light = names.filter((f) => sizeOf(f) <= MAX_BYTES)
  return (light.length ? light : names).sort()
}

function typeOf(name) {
  const n = name.toLowerCase()
  if (n.endsWith('.png')) return 'image/png'
  if (n.endsWith('.gif')) return 'image/gif'
  if (n.endsWith('.webp')) return 'image/webp'
  if (n.endsWith('.avif')) return 'image/avif'
  return 'image/jpeg'
}

export function fishStaticPlugin() {
  return {
    name: 'shadowing-fish-static',
    configureServer(server) {
      const fishDir = resolve(server.config.root, 'assets/imgs/fish')
      server.middlewares.use((req, res, next) => {
        const path = (req.url || '').split('?')[0]
        if (path !== '/fish' && path !== '/fish/manifest.json' && !path.startsWith('/fish/')) return next()

        if (path === '/fish' || path === '/fish/manifest.json') {
          const names = listFish(fishDir)
          res.statusCode = 200
          res.setHeader('Content-Type', 'application/json; charset=utf-8')
          res.end(JSON.stringify(names))
          return
        }

        let name = ''
        try {
          name = decodeURIComponent(path.slice('/fish/'.length))
        } catch {
          res.statusCode = 400
          res.end('bad name')
          return
        }
        if (!name || name.includes('..') || name.includes('/') || name.includes('\\') || !IMG.test(name)) {
          res.statusCode = 400
          res.end('bad name')
          return
        }
        const file = join(fishDir, name)
        if (!existsSync(file) || !statSync(file).isFile()) {
          res.statusCode = 404
          res.end('not found')
          return
        }
        res.statusCode = 200
        res.setHeader('Content-Type', typeOf(name))
        res.setHeader('Content-Length', statSync(file).size)
        res.setHeader('Cache-Control', 'no-cache')
        createReadStream(file).pipe(res)
      })
    },
  }
}
