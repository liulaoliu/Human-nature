import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

/**
 * dev-only：「存入项目」按钮 POST /__state 时，把备份写到
 * `public/shadowing-state.json`。换电脑时 git pull 下来，
 * 第一次打开会自动用它初始化 localStorage（见 src/main.tsx）。
 * 生产构建没有这个接口，App 会退回「下载」。
 *
 * 放在 .mjs 里是因为它要用 node:fs，而项目没装 @types/node、也不该把
 * Node 类型塞进前端的 tsconfig。
 */
export function projectStatePlugin() {
  return {
    name: 'shadowing-project-state',
    configureServer(server) {
      server.middlewares.use('/__state', (req, res, next) => {
        if (req.method !== 'POST') return next()
        let body = ''
        req.on('data', (chunk) => {
          body += chunk
        })
        req.on('end', () => {
          try {
            JSON.parse(body) // 只收合法 JSON
            const dir = resolve(server.config.root, 'public')
            mkdirSync(dir, { recursive: true })
            writeFileSync(resolve(dir, 'shadowing-state.json'), body, 'utf8')
            res.statusCode = 200
            res.setHeader('Content-Type', 'application/json')
            res.end('{"ok":true}')
          } catch {
            res.statusCode = 400
            res.end('{"ok":false}')
          }
        })
      })
    },
  }
}
