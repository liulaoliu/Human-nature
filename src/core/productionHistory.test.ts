import { describe, expect, it } from 'vitest'
import type { ProductionTarget } from './production'
import { makeProductionTask } from './productionPrompts'
import type { WritingRecord } from './writing'
import {
  deriveProductionProgress,
  filterProductionHistory,
  groupProductionAttempts,
  productionHistoryMarkdown,
  productionRecords,
  productionStats,
} from './productionHistory'

const target: ProductionTarget = {
  id: 'v1|self|word',
  itemId: 'v1',
  kind: 'word',
  text: 'follow up',
  meaning: '跟进',
}

function record(over: Partial<WritingRecord> = {}): WritingRecord {
  const task = makeProductionTask(
    {
      id: 'p1',
      zh: '跟同事说明进度',
      goal: '说明进度',
      targets: [target],
      ...(over.task ? {} : {}),
    },
    '工作',
    'full',
    's1',
  )
  return {
    at: '2026-11-01T10:00:00.000Z',
    articleId: 'A',
    articleTitle: 'A',
    model: task.model,
    text: 'I will follow up.',
    feedback: {
      version: 2,
      scores: [],
      total: 80,
      max: 100,
      issues: [],
      recommendations: [],
      polished: '',
      summary: '',
    },
    task: { ...task, hits: [{ ...target, used: true }], round: 1 } as unknown as WritingRecord['task'],
    source: 'production',
    ...over,
  }
}

describe('productionHistory：从 attempts 派生进度 / 统计', () => {
  it('命中升一档，漏用立刻到期；记录本身不被修改', () => {
    const hit = record()
    const miss = record({
      at: '2026-11-02T10:00:00.000Z',
      task: {
        ...(hit.task as unknown as Record<string, unknown>),
        hits: [{ ...target, used: false }],
        round: 2,
      } as unknown as WritingRecord['task'],
    })
    const list = [hit, miss]
    const before = JSON.stringify(list)
    const progress = deriveProductionProgress(list)
    expect(JSON.stringify(list)).toBe(before)
    expect(progress).toHaveLength(1)
    expect(progress[0]).toMatchObject({ text: 'follow up', attempts: 2, hits: 1, misses: 1, streak: 0 })
    expect(progress[0].dueAt).toBe('2026-11-02T10:00:00.000Z')
  })

  it('统计次数 / 重写 / 命中率 / 平均分；筛选按文章、模式、主题', () => {
    const a = record()
    const b = record({
      at: '2026-11-02T10:00:00.000Z',
      text: 'I will follow up tomorrow.',
      task: {
        ...(a.task as unknown as Record<string, unknown>),
        round: 2,
        hits: [{ ...target, used: true }],
      } as unknown as WritingRecord['task'],
    })
    const list = [a, b]
    const stats = productionStats(list)
    expect(stats).toMatchObject({ attempts: 2, sessions: 1, rewrites: 1, targetHits: 2, hitRate: 1, avgScore: 80 })
    expect(filterProductionHistory(list, { articleId: 'A', mode: 'full', topic: '工作' })).toHaveLength(2)
    expect(filterProductionHistory(list, { mode: 'yogurt' })).toHaveLength(0)
    expect(productionRecords(list)).toHaveLength(2)
    expect(groupProductionAttempts(list)[0].records).toHaveLength(2)
    expect(productionHistoryMarkdown(list)).toContain('跟同事说明进度')
  })

  it('跳过稿进历史但不计入真实产出 / 平均分', () => {
    const real = record()
    const skipped = record({
      text: '',
      feedback: {
        version: 2,
        scores: [],
        total: 0,
        max: 0,
        issues: [],
        recommendations: [],
        polished: '',
        summary: '跳过（未提交）',
      },
      task: {
        ...(real.task as unknown as Record<string, unknown>),
        skipped: true,
        hits: [],
      } as unknown as WritingRecord['task'],
    })
    const list = [real, skipped]
    expect(productionStats(list)).toMatchObject({ attempts: 1, avgScore: 80, targetAttempts: 1 })
    expect(productionHistoryMarkdown(list)).toContain('跳过（未提交，无 AI 批改）')
  })
})
