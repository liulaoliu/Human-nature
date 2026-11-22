import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import AppRoutes from './AppRoutes'
import { normalizeLegacyUrl } from './core/legacyUrl'
import './global.css'

/**
 * 单入口 SPA：
 *
 *   index.html 是唯一 HTML，React 只在这里 createRoot 一次；
 *   `/`（跟读）与 `/reader/**`（精读）由 `AppRoutes` 在同一棵树里切。
 *
 * 以前这里是 index.html + reader.html 两个入口、两个 root，互跳要整页重载，
 * 阅读页面板也没有跨文档的历史可退。
 */

/** 老地址（收藏夹 / 外链）迁到干净路径：`/reader.html#/a/x` → `/reader/a/x`。 */
function migrateLegacyUrl() {
  const { pathname, search, hash } = window.location
  const next = normalizeLegacyUrl(pathname, search, hash)
  if (next) history.replaceState(null, '', next)
}

function boot() {
  migrateLegacyUrl()
  createRoot(document.getElementById('root')!).render(
    <BrowserRouter>
      <AppRoutes />
    </BrowserRouter>,
  )
}

void boot()
