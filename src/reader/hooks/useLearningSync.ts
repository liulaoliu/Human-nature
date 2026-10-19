import { useEffect } from 'react'
import type { LearningSection } from '../../core/learning'
import { learningSectionForKey, syncLearningToServer } from '../learningState'

const DEBOUNCE_MS = 800

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
    let initial = true
    const pending = new Set<LearningSection>()

    const flush = () => {
      timer = null
      if (initial) {
        // 首次启动整份补一次库：服务端为空时把本地历史数据灌进去。
        initial = false
        pending.clear()
        void syncLearningToServer()
        return
      }
      const sections = [...pending]
      pending.clear()
      if (sections.length) void syncLearningToServer(sections)
    }
    const schedule = () => {
      if (timer !== null) return
      timer = setTimeout(flush, DEBOUNCE_MS)
    }
    const note = (key: string | null | undefined) => {
      const section = learningSectionForKey(key)
      if (!section) return
      pending.add(section)
      schedule()
    }
    const onLocal = (e: Event) => {
      note((e as CustomEvent<{ key?: string }>).detail?.key)
    }
    const onStorage = (e: StorageEvent) => {
      note(e.key)
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
