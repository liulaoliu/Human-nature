import { createRoot } from 'react-dom/client'
import ReaderApp from './ReaderApp'

try {
  document.documentElement.dataset.theme =
    localStorage.getItem('reader:theme') === 'green' ? 'green' : 'dark'
} catch {
  // 忽略
}

createRoot(document.getElementById('reader-root')!).render(<ReaderApp />)
