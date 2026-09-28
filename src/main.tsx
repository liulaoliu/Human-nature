import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './ui/App'
import { applyLocalState, loadProjectSeed, localStateIsEmpty } from './adapters/stateBackup'
import './ui/styles.css'

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
