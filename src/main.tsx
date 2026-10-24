import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import AppRoutes from './AppRoutes'
import { applyLocalState, loadProjectSeed, localStateIsEmpty } from './adapters/stateBackup'
import { normalizeLegacyUrl } from './core/legacyUrl'
import './ui/styles.css'

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

async function boot() {
  migrateLegacyUrl()
  // 新电脑第一次打开：localStorage 还空着就用项目里的种子文件初始化
  // （public/shadowing-state.json，由「存入项目」生成）
  if (localStateIsEmpty()) {
    const seed = await loadProjectSeed()
    if (seed) applyLocalState(seed.data)
  }
  createRoot(document.getElementById('root')!).render(
    <BrowserRouter>
      <AppRoutes />
    </BrowserRouter>,
  )
}

void boot()
