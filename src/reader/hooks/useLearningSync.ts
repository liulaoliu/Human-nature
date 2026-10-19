import { useEffect } from 'react'
import { isLearningKey, syncLearningToServer } from '../learningState'

const DEBOUNCE_MS = 800

/**
 * 学习记录写回 SQLite。
 *
 * `useLocalStorageState` 每次写入会发 `reader:local-state`；这里只接学习记录键，
 * 防抖后整份写回 `/api/store/learning`。偏好/会话键不触发写库。
 *
 * 这是“同步缓存 → 耐久副本”，不是把 localStorage 全部镜像进 SQLite。
 */
export function useLearningSync(): void {
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null

    const flush = () => {
      timer = null
      void syncLearningToServer()
    }
    const schedule = () => {
      if (timer !== null) return
      timer = setTimeout(flush, DEBOUNCE_MS)
    }
    const onLocal = (e: Event) => {
      const key = (e as CustomEvent<{ key?: string }>).detail?.key
      if (isLearningKey(key)) schedule()
    }
    const onStorage = (e: StorageEvent) => {
      if (isLearningKey(e.key)) schedule()
    }

    window.addEventListener('reader:local-state', onLocal)
    window.addEventListener('storage', onStorage)
    window.addEventListener('pagehide', flush)
    // 首次启动也同步一次：把本地已有数据补进新库（服务端为空时）。
    schedule()

    return () => {
      if (timer !== null) clearTimeout(timer)
      window.removeEventListener('reader:local-state', onLocal)
      window.removeEventListener('storage', onStorage)
      window.removeEventListener('pagehide', flush)
    }
  }, [])
}
