import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import ReaderApp from './ReaderApp'
import { hydrateLearningFromServer, readLearningFromLocalStorage } from './learningState'
import { hasLearningData } from '../core/learning'
import { useLearningSync } from './hooks/useLearningSync'

/** 把同步缓存接上 SQLite；单独包一层，避免 ReaderApp 继续长。 */
function ReaderRoot() {
  useLearningSync()
  return <ReaderApp />
}

/**
 * 阅读页挂在 `/reader` 下，路径用 BrowserRouter（干净路径，没有 `#`）：
 *
 *   /reader                    文章列表
 *   /reader/a/<ref>            读某一篇
 *   /reader/a/<ref>/p/<panel>  读某一篇 + 开某个面板
 *   /reader/p/<panel>          没文章时也能开的面板
 *
 * 服务端（dev 的 vite 插件 / 生产的 httpApp）把 `/reader**` 回落到 `reader.html`。
 */
const BASE = '/reader'

/** 老地址 `reader.html#/a/xxx` → `/reader/a/xxx`（收藏夹里的链接不能一打开就白屏）。 */
function normalizeEntryUrl() {
  if (location.pathname !== '/reader.html') return
  const fromHash = location.hash.replace(/^#/, '')
  const path = fromHash && fromHash !== '/' ? fromHash : ''
  history.replaceState(null, '', BASE + path + location.search)
}

async function boot() {
  normalizeEntryUrl()
  try {
    document.documentElement.dataset.theme =
      localStorage.getItem('reader:theme') === 'green' ? 'green' : 'dark'
  } catch {
    // 忽略
  }
  // 学习记录的水合以前**无条件**挡在 render 之前：一个网络往返之内页面是纯白屏。
  // 它实际只做一件事 —— 把服务端有、localStorage 里缺的补进来。所以分两种：
  //   · 本地已有记录（绝大多数情况）→ 先画，后台补；
  //   · 本地空（首次 / 清了缓存）→ 首帧真的需要它，那就等，但最多 600ms（超时先画）。
  const localKnown = hasLearningData(readLearningFromLocalStorage())
  if (!localKnown) {
    await Promise.race([
      hydrateLearningFromServer(),
      new Promise((resolve) => setTimeout(resolve, 600)),
    ])
  }
  createRoot(document.getElementById('reader-root')!).render(
    <BrowserRouter basename={BASE}>
      <ReaderRoot />
    </BrowserRouter>,
  )
  if (localKnown) void hydrateLearningFromServer()
}

void boot()
