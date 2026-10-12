import { handleAiApi } from './ai-core.mjs'

/**
 * dev-only：把 `/api/ai/*`（一键跑批）接到 dev server 上，让 `npm run dev` 下
 * 阅读页的「⚡ 一键跑批」也能用。生产环境由 server/httpApp.js 提供同一接口。
 * 放在 .mjs 里是因为要用 node:fs / fetch，不进前端 tsconfig。
 */
export function aiEndpointPlugin() {
  return {
    name: 'shadowing-ai-endpoint',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (!req.url || !req.url.startsWith('/api/ai/')) return next()
        handleAiApi(req, res, { root: server.config.root })
      })
    },
  }
}
