import { StrictMode, Suspense, lazy } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import App from './ui/App'

/**
 * 阅读页按路由懒加载：单入口不等于把所有代码塞进首包。
 * 跟读页 / 阅读页共用同一个 HTML 与同一个 Router，但词典 / PDF / 面板这些
 * 只有进 `/reader` 才需要，仍然单独切 chunk。
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
 *   /            跟读练习（原 index.html 的 App）
 *   /reader/**   精读 / 生词本（原 reader.html 的 ReaderApp）
 *
 * 两段在**同一棵 React 树**里，互相跳转不再整页刷新；浏览器前进/后退
 * 能跨段走：/ → /reader → /reader/a/<slug> → /reader/a/<slug>/p/<panel>。
 *
 * `StrictMode` 只包跟读页：阅读页原本就没有它（双调用 effect 会重复触发生效的
 * 学习记录同步），合并入口时保持原样，别顺手加。
 */
export default function AppRoutes() {
  return (
    <Suspense fallback={<RouteLoading />}>
      <Routes>
        <Route
          path="/"
          element={
            <StrictMode>
              <App />
            </StrictMode>
          }
        />
        <Route path="/reader/*" element={<ReaderRoot />} />
        {/* 认不出的地址回首页；旧 /reader.html、/index.html 在启动时已换成干净路径 */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Suspense>
  )
}
