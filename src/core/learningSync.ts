/**
 * 学习记录同步的**纯状态机**（不碰 timer / localStorage / fetch）。
 *
 * 以前这段逻辑长在 `useLearningSync` 的 effect 里：`needFull`、`pending`、`retryDelay`
 * 和定时器混在一起，只能靠 hook 测试间接覆盖。抽出来后：
 *   - 什么时候整份重试、什么时候只提交变化 section、退避多久，都能直接单测；
 *   - hook 只负责订阅事件、起定时器、调用仓储。
 */
import type { LearningSection } from './learning'

export const SYNC_RETRY_MS = 5_000
export const SYNC_RETRY_MAX_MS = 60_000

export interface LearningSyncState {
  /** 下一次必须整份写（启动补库 / 失败后弥补漏掉的 section） */
  needFull: boolean
  /** 已变更、还没提交的 section */
  pending: Set<LearningSection>
  /** 下一次失败后的等待时间 */
  retryDelay: number
}

export interface LearningSyncPlan {
  full: boolean
  /** full=false 时才有：本次要提交的 section */
  sections?: LearningSection[]
}

export function createLearningSyncState(): LearningSyncState {
  return { needFull: true, pending: new Set(), retryDelay: SYNC_RETRY_MS }
}

export function noteLearningSection(state: LearningSyncState, section: LearningSection): void {
  state.pending.add(section)
}

/** 取出本轮计划；没有要写的返回 null。取走即清空 pending（失败时由 needFull 兜底）。 */
export function takeLearningPlan(state: LearningSyncState): LearningSyncPlan | null {
  if (state.needFull) {
    state.needFull = false
    state.pending.clear()
    return { full: true }
  }
  if (!state.pending.size) return null
  const sections = [...state.pending]
  state.pending.clear()
  return { full: false, sections }
}

/** 写成功：退避重置；若期间又有新变更，pending 里还在，调用方继续 schedule。 */
export function markLearningSyncOk(state: LearningSyncState): void {
  state.retryDelay = SYNC_RETRY_MS
}

/**
 * 写失败：下一轮必须整份重试（只重放 pending 会漏掉更早失败的 section）。
 * 返回**本次**应该等待的毫秒数（然后内部翻倍，封顶 60s）。
 */
export function markLearningSyncFailed(state: LearningSyncState): number {
  state.needFull = true
  const delay = state.retryDelay
  state.retryDelay = Math.min(state.retryDelay * 2, SYNC_RETRY_MAX_MS)
  return delay
}
