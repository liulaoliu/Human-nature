import { useEffect, useLayoutEffect, useState } from 'react'
import ReaderApp from './ReaderApp'
import readerCss from './reader.css?inline'
import { hydrateLearningFromServer, readLearningFromLocalStorage } from './learningState'
import { hasLearningData } from '../core/learning'
import { useLearningSync } from './hooks/useLearningSync'

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
 * 水合仍按老策略：本地已有学习记录 → 先画、后台补；本地为空（首次 / 清了缓存）
 * → 最多等 600ms，超时也先画，不能白屏。
 */
export default function ReaderRoot() {
  const [localKnown] = useState(() => hasLearningData(readLearningFromLocalStorage()))
  const [ready, setReady] = useState(localKnown)

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
    if (localKnown) {
      void hydrateLearningFromServer()
      return
    }
    const timer = window.setTimeout(() => {
      if (alive) setReady(true)
    }, 600)
    void hydrateLearningFromServer().finally(() => {
      if (!alive) return
      window.clearTimeout(timer)
      setReady(true)
    })
    return () => {
      alive = false
      window.clearTimeout(timer)
    }
  }, [localKnown])

  if (!ready) return <LearningSkeleton />
  return <ReaderReady />
}
