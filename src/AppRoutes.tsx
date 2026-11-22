import { Suspense, lazy } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'

/**
 * 阅读页按路由懒加载：单入口不等于把所有代码塞进首包。
 * 词典 / PDF / 面板这些只有进 `/reader` 才需要，仍然单独切 chunk。
 */
const ReaderRoot = lazy(() => import('./reader/ReaderRoot'))

function RouteLoading() {
  return (
    <div className="boot-skeleton route-loading" aria-hidden="true">
      <div className="line" style={{ width: '92%' }} />
      <div className="line" style={{ width: '86%' }} />
      <div className="line" style={{ width: '95%' }} />
      <p className="hint">正在打开…</p>
    </div>
  )
}

/**
 * 全站路由树（单入口 SPA）。
 *
 *   /            直接进阅读页（replace 到 /reader）
 *   /reader/**   精读 / 生词本
 *
 * 旧的跟读页（`/`，`src/ui`）已经下线：项目从「跟读 + 精读两套页面」
 * 收敛成只有一个阅读页，速读里的「🎧 复读」接替了原来跟读的练习场景。
 *
 * 保留 `/reader/**` 这一层而不是把阅读页直接挂在 `/`：收藏夹、旧链接、
 * `panelPath()` 生成的地址都还指着它；`/` 只做一次跳转，历史里不留空页。
 */
export default function AppRoutes() {
  return (
    <Suspense fallback={<RouteLoading />}>
      <Routes>
        <Route path="/" element={<Navigate to="/reader" replace />} />
        <Route path="/reader/*" element={<ReaderRoot />} />
        {/* 认不出的地址回阅读页；旧 /reader.html、/index.html 在启动时已换成干净路径 */}
        <Route path="*" element={<Navigate to="/reader" replace />} />
      </Routes>
    </Suspense>
  )
}
