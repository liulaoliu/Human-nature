import { useEffect, useLayoutEffect, useState } from 'react'
import ReaderApp from './ReaderApp'
import readerCss from './reader.css?inline'
import { hydrateLearningFromServer } from './learningState'
import { useLearningSync } from './hooks/useLearningSync'

/** 最多等这么久；服务端在本机时通常几十毫秒，静态部署 health 404 也很快。 */
const HYDRATE_TIMEOUT_MS = 3000

/** 同步缓存接 SQLite；放在水合完成之后，避免「空库先整份写回」把服务端记录盖掉。 */
function ReaderReady() {
  useLearningSync()
  return <ReaderApp />
}

/** 学习记录就绪前的占位（沿用 index.html 里的骨架样式）。 */
function LearningSkeleton() {
  return (
    <div className="boot-skeleton route-loading" aria-hidden="true">
      <div className="line" style={{ width: '92%' }} />
      <div className="line" style={{ width: '86%' }} />
      <div className="line" style={{ width: '95%' }} />
      <p className="hint">正在恢复学习记录…</p>
    </div>
  )
}

/**
 * 阅读页在**单入口 SPA** 里的根组件（由 `src/main.tsx` 的路由 `/reader/*` 挂载）。
 *
 * 以前这里是 `src/reader/main.tsx`：自己 `createRoot`、自己 `BrowserRouter basename`、
 * 自己一套 HTML。合并成一个入口后，启动只剩一处，这里改成一个普通组件。
 *
 * 水合策略：**先等 SQLite 的学习记录落进 localStorage，再挂 ReaderApp**。
 * 旧代码在「本地已有记录」时立刻挂载、后台水合，结果 React state 已经用旧缓存初始化，
 * 服务端较新的记录只写进了 localStorage，用户随后一改就反过来把服务端盖掉（P1-2）。
 * 本地服务正常时这一步只多几十毫秒；服务不可用 / 静态部署时 health 很快失败；
 * 最坏等待 `HYDRATE_TIMEOUT_MS`，超时也先画，不能白屏。
 */
export default function ReaderRoot() {
  const [ready, setReady] = useState(false)

  /**
   * 阅读页 CSS 手动注入 / 卸载。
   *
   * 单入口后 `styles.css` 一直挂着；如果 reader.css 走普通的懒加载 import，Vite 会把
   * `<link>` 留在 head 里 —— 从 /reader 返回跟读页后，阅读页的全局 body / button /
   * ::selection 规则还在，跟读页会被悄悄改样式。这里改成 `?inline` 字符串，
   * 进阅读页前注入、离开就删，两边互不污染。
   */
  useLayoutEffect(() => {
    const style = document.createElement('style')
    style.dataset.readerStyles = ''
    style.textContent = readerCss
    document.head.appendChild(style)
    return () => style.remove()
  }, [])

  useEffect(() => {
    let alive = true
    const timer = window.setTimeout(() => {
      if (alive) setReady(true)
    }, HYDRATE_TIMEOUT_MS)
    void hydrateLearningFromServer()
      .catch(() => {
        // hydrateLearningFromServer 内部已兜住服务不可用；这里再兜一层，调用方不需要处理
      })
      .finally(() => {
        if (!alive) return
        window.clearTimeout(timer)
        setReady(true)
      })
    return () => {
      alive = false
      window.clearTimeout(timer)
    }
  }, [])

  if (!ready) return <LearningSkeleton />
  return <ReaderReady />
}
