import { describe, it, expect } from 'vitest'
import {
  AI_JOB_TASKS,
  AI_TASK_LABEL,
  AI_JOB_PACK_VERSION,
  isAiJobTask,
} from './aiJobTypes'

describe('aiJobTypes 任务清单', () => {
  it('isAiJobTask 只认清单里的任务', () => {
    for (const t of AI_JOB_TASKS) expect(isAiJobTask(t), t).toBe(true)
    expect(isAiJobTask('unknown')).toBe(false)
    expect(isAiJobTask('')).toBe(false)
    expect(isAiJobTask(null)).toBe(false)
    expect(isAiJobTask(1)).toBe(false)
  })

  it('每个任务都有中文名（漏一个面板会显示 undefined）', () => {
    for (const t of AI_JOB_TASKS) {
      expect(AI_TASK_LABEL[t], t).toBeTruthy()
    }
  })

  it('任务名不重复，且包版本为 1', () => {
    expect(new Set(AI_JOB_TASKS).size).toBe(AI_JOB_TASKS.length)
    expect(AI_JOB_PACK_VERSION).toBe(1)
  })
})
