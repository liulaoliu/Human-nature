import { useEffect } from 'react'
import { hasLearningData, type LearningSection } from '../../core/learning'
import {
  hasPendingLearningChanges,
  learningSectionForKey,
  markLearningDirty,
  readLearningFromLocalStorage,
  syncLearningToServer,
} from '../learningState'

const DEBOUNCE_MS = 800
const RETRY_MS = 5_000
const RETRY_MAX_MS = 60_000

/**
 * 学习记录写回 SQLite。
 *
 * `useLocalStorageState` 每次写入会发 `reader:local-state`；这里只接学习记录键，
 * 防抖后按 section 增量写 `/api/store/learning/partial`。偏好/会话键不触发写库。
 *
 * 这是“同步缓存 → 耐久副本”，不是把 localStorage 全部镜像进 SQLite。
 */
export function useLearningSync(): void {
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null
    let retryTimer: ReturnType<typeof setTimeout> | null = null
    let retryDelay = RETRY_MS
    let needFull = true
    let inFlight = false
    let disposed = false
    const pending = new Set<LearningSection>()

    const hasSomethingToSync = () =>
      hasLearningData(readLearningFromLocalStorage()) || hasPendingLearningChanges()

    const scheduleRetry = () => {
      if (retryTimer !== null || !hasSomethingToSync()) return
      retryTimer = setTimeout(() => {
        retryTimer = null
        void flush()
      }, retryDelay)
      retryDelay = Math.min(retryDelay * 2, RETRY_MAX_MS)
    }

    const flush = async () => {
      if (timer !== null) {
        clearTimeout(timer)
        timer = null
      }
      if (disposed || inFlight || (!needFull && !pending.size)) return
      inFlight = true
      const full = needFull
      const sections = full ? undefined : [...pending]
      if (full) needFull = false
      pending.clear()
      let ok = false
      try {
        ok = await syncLearningToServer(sections)
      } finally {
        inFlight = false
      }
      if (disposed) return
      if (ok) {
        retryDelay = RETRY_MS
        if (pending.size) schedule()
        return
      }
      // 失败就退回“整份重试”：离线期间可能只记下了后来改的那一块，
      // 只重放 pending 会漏掉更早没写成功的 section。
      needFull = true
      scheduleRetry()
    }
    const schedule = () => {
      if (timer !== null) return
      timer = setTimeout(() => void flush(), DEBOUNCE_MS)
    }
    const note = (key: string | null | undefined) => {
      const section = learningSectionForKey(key)
      if (!section) return
      markLearningDirty()
      pending.add(section)
      schedule()
    }
    const onLocal = (e: Event) => {
      note((e as CustomEvent<{ key?: string }>).detail?.key)
    }
    const onStorage = (e: StorageEvent) => {
      note(e.key)
    }
    const onOnline = () => schedule()
    const onPageHide = () => void flush()

    window.addEventListener('reader:local-state', onLocal)
    window.addEventListener('storage', onStorage)
    window.addEventListener('online', onOnline)
    window.addEventListener('pagehide', onPageHide)
    // 首次启动也同步一次：把本地已有数据补进新库（服务端为空时）。
    schedule()

    return () => {
      disposed = true
      if (timer !== null) clearTimeout(timer)
      if (retryTimer !== null) clearTimeout(retryTimer)
      window.removeEventListener('reader:local-state', onLocal)
      window.removeEventListener('storage', onStorage)
      window.removeEventListener('online', onOnline)
      window.removeEventListener('pagehide', onPageHide)
    }
  }, [])
}
