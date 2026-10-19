import { useEffect } from 'react'
import { hasLearningData } from '../../core/learning'
import {
  createLearningSyncState,
  markLearningSyncFailed,
  markLearningSyncOk,
  noteLearningSection,
  takeLearningPlan,
} from '../../core/learningSync'
import type { LearningRepoPort } from '../../core/ports'
import { learningRepo } from '../../adapters/learningRepo'
import {
  hasPendingLearningChanges,
  learningSectionForKey,
  markLearningDirty,
  readLearningFromLocalStorage,
  syncLearningToServer,
} from '../learningState'

const DEBOUNCE_MS = 800

/**
 * 学习记录写回 SQLite。
 *
 * `useLocalStorageState` 每次写入会发 `reader:local-state`；这里只接学习记录键，
 * 防抖后按 section 增量写 `/api/store/learning/partial`。偏好/会话键不触发写库。
 *
 * 状态迁移（整份 / 增量 / 失败退避）在 `core/learningSync.ts`，这里只做接线：
 * 订阅事件、起定时器、把计划交给注入的仓储。仓储默认 SQLite，测试可注入假实现。
 *
 * 这是“同步缓存 → 耐久副本”，不是把 localStorage 全部镜像进 SQLite。
 */
export function useLearningSync(repo: LearningRepoPort = learningRepo): void {
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null
    let retryTimer: ReturnType<typeof setTimeout> | null = null
    let inFlight = false
    let disposed = false
    const state = createLearningSyncState()

    const hasSomethingToSync = () =>
      hasLearningData(readLearningFromLocalStorage()) || hasPendingLearningChanges()

    const scheduleRetry = (delay: number) => {
      if (retryTimer !== null || !hasSomethingToSync()) return
      retryTimer = setTimeout(() => {
        retryTimer = null
        void flush()
      }, delay)
    }

    const flush = async () => {
      if (timer !== null) {
        clearTimeout(timer)
        timer = null
      }
      if (disposed || inFlight) return
      const plan = takeLearningPlan(state)
      if (!plan) return
      inFlight = true
      let ok = false
      try {
        ok = await syncLearningToServer(plan.full ? undefined : plan.sections, repo)
      } finally {
        inFlight = false
      }
      if (disposed) return
      if (ok) {
        markLearningSyncOk(state)
        if (state.pending.size) schedule()
        return
      }
      // 失败就退回“整份重试”：离线期间可能只记下了后来改的那一块，
      // 只重放 pending 会漏掉更早没写成功的 section。
      scheduleRetry(markLearningSyncFailed(state))
    }
    const schedule = () => {
      if (timer !== null) return
      timer = setTimeout(() => void flush(), DEBOUNCE_MS)
    }
    const note = (key: string | null | undefined) => {
      const section = learningSectionForKey(key)
      if (!section) return
      markLearningDirty()
      noteLearningSection(state, section)
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
  }, [repo])
}
