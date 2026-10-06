import { resolve } from 'node:path'
import { handleTts } from './tts-core.mjs'

/**
 * dev-only：把 `/api/tts` 接到 Edge TTS（见 tts-core.mjs）。
 * 静态模式由 server/httpApp.js 提供同款接口。
 *
 * 放 .mjs 是因为要用 node:fs / 动态 import node-edge-tts，
 * 而前端 tsconfig 不装 @types/node。
 */
export function ttsEndpointPlugin() {
  return {
    name: 'shadowing-tts-endpoint',
    configureServer(server) {
      const cacheDir = resolve(server.config.root, 'public', 'tts')
      server.middlewares.use((req, res, next) => {
        const path = (req.url || '').split('?')[0]
        if (path !== '/api/tts' && path !== '/api/tts/words') return next()
        handleTts(req, res, { cacheDir }).catch(() => {
          if (!res.headersSent) {
            res.statusCode = 500
            res.end('tts error')
          }
        })
      })
    },
  }
}
