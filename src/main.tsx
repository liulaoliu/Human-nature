import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './ui/App'
import { applyLocalState, loadProjectSeed, localStateIsEmpty } from './adapters/stateBackup'
import './ui/styles.css'

// 护眼主题（reader 页切换后存本机），这里在首帧前应用，避免闪一下
try {
  document.documentElement.dataset.theme =
    localStorage.getItem('reader:theme') === 'green' ? 'green' : 'dark'
} catch {
  // 忽略
}

async function boot() {
  // 新电脑第一次打开：localStorage 还空着就用项目里的种子文件初始化
  // （public/shadowing-state.json，由「存入项目」生成）
  if (localStateIsEmpty()) {
    const seed = await loadProjectSeed()
    if (seed) applyLocalState(seed.data)
  }
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  )
}

void boot()
