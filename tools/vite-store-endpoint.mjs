import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { handleStoreApi } from '../server/storeApi.ts'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

function attach(server) {
  server.middlewares.use((req, res, next) => {
    if (!req.url?.startsWith('/api/store')) {
      next()
      return
    }
    handleStoreApi(req, res, { root }).catch((e) => {
      if (res.headersSent) return
      res.statusCode = 500
      res.setHeader('Content-Type', 'application/json; charset=utf-8')
      res.end(JSON.stringify({ ok: false, error: e instanceof Error ? e.message : 'store error' }))
    })
  })
}

/** dev / preview 共用的 `/api/store/*` 中间件。 */
export function storeEndpointPlugin() {
  return {
    name: 'xueba-store',
    configureServer(server) {
      attach(server)
    },
    configurePreviewServer(server) {
      attach(server)
    },
  }
}
