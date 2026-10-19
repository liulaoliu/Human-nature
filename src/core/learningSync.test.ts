import { describe, expect, it } from 'vitest'
import {
  SYNC_RETRY_MAX_MS,
  SYNC_RETRY_MS,
  createLearningSyncState,
  markLearningSyncFailed,
  markLearningSyncOk,
  noteLearningSection,
  takeLearningPlan,
} from './learningSync'

describe('learningSync 状态机', () => {
  it('首次启动整份同步；取走后没有新变更就不再有计划', () => {
    const s = createLearningSyncState()
    expect(takeLearningPlan(s)).toEqual({ full: true })
    expect(takeLearningPlan(s)).toBeNull()
  })

  it('只记变更的 section：整份之后走增量，取走即清空', () => {
    const s = createLearningSyncState()
    takeLearningPlan(s)
    noteLearningSection(s, 'practice')
    noteLearningSection(s, 'activity')
    noteLearningSection(s, 'practice')
    expect(takeLearningPlan(s)).toEqual({ full: false, sections: ['practice', 'activity'] })
    expect(takeLearningPlan(s)).toBeNull()
  })

  it('失败后退避 5s 起、翻倍、封顶 60s；且下一轮强制整份', () => {
    const s = createLearningSyncState()
    takeLearningPlan(s)
    const waits: number[] = []
    for (let i = 0; i < 6; i++) waits.push(markLearningSyncFailed(s))
    expect(waits).toEqual([5_000, 10_000, 20_000, 40_000, 60_000, 60_000])
    expect(SYNC_RETRY_MAX_MS).toBe(60_000)
    expect(takeLearningPlan(s)).toEqual({ full: true })
  })

  it('成功后退避重置回 5s', () => {
    const s = createLearningSyncState()
    markLearningSyncFailed(s)
    markLearningSyncFailed(s)
    markLearningSyncOk(s)
    expect(s.retryDelay).toBe(SYNC_RETRY_MS)
    expect(markLearningSyncFailed(s)).toBe(SYNC_RETRY_MS)
  })
})
