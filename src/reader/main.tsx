import { createRoot } from 'react-dom/client'
import { HashRouter } from 'react-router-dom'
import ReaderApp from './ReaderApp'
import { hydrateLearningFromServer } from './learningState'
import { useLearningSync } from './hooks/useLearningSync'

/** 把同步缓存接上 SQLite；单独包一层，避免 ReaderApp 继续长。 */
function ReaderRoot() {
  useLearningSync()
  return <ReaderApp />
}

async function boot() {
  // 先补 localStorage 里缺的学习记录，再挂载；否则各 hook 的首帧读不到。
  await hydrateLearningFromServer()
  try {
    document.documentElement.dataset.theme =
      localStorage.getItem('reader:theme') === 'green' ? 'green' : 'dark'
  } catch {
    // 忽略
  }
  createRoot(document.getElementById('reader-root')!).render(
    <HashRouter>
      <ReaderRoot />
    </HashRouter>,
  )
}

void boot()
