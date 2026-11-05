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
  productionReviewCounts,
  productionStats,
  assignLegacyProductionSessionIds,
  mergeProductionProgress,
  normalizeProductionProgress,
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

  it('提醒数：到期按 dueAt，薄弱按漏用 / 命中率', () => {
    const counts = productionReviewCounts(
      [
        {
          key: 'word:run',
          kind: 'word',
          text: 'run',
          meaning: '跑',
          streak: 0,
          attempts: 2,
          hits: 0,
          misses: 2,
          dueAt: '2026-11-01T00:00:00.000Z',
          lastAt: '2026-11-01T00:00:00.000Z',
        },
        {
          key: 'word:curb',
          kind: 'word',
          text: 'curb',
          meaning: '抑制',
          streak: 2,
          attempts: 2,
          hits: 2,
          misses: 0,
          dueAt: '2027-01-01T00:00:00.000Z',
          lastAt: '2026-11-01T00:00:00.000Z',
        },
      ],
      '2026-11-05T00:00:00.000Z',
    )
    expect(counts).toEqual({ due: 1, weak: 1, newTargets: 0 })

    const withNew = productionReviewCounts(
      [
        {
          key: 'word:run',
          kind: 'word',
          text: 'run',
          meaning: '跑',
          streak: 0,
          attempts: 1,
          hits: 1,
          misses: 0,
          dueAt: '2027-01-01T00:00:00.000Z',
          lastAt: '2026-11-01T00:00:00.000Z',
        },
      ],
      '2026-11-05T00:00:00.000Z',
      [
        { id: 'run', itemId: 'run', kind: 'word', text: 'run', meaning: '跑' },
        { id: 'curb', itemId: 'curb', kind: 'word', text: 'curb', meaning: '抑制' },
      ],
    )
    expect(withNew.newTargets).toBe(1)
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

  it('进度表守卫：坏行丢弃，合并取更新的一行', () => {
    const rows = normalizeProductionProgress([
      {
        key: 'word:run',
        kind: 'word',
        text: 'run',
        meaning: '跑',
        attempts: 2,
        hits: 1,
        misses: 1,
        streak: 0,
        lastAt: '2026-11-01T00:00:00.000Z',
        dueAt: '2026-11-02T00:00:00.000Z',
        updatedAt: '2026-11-01T00:00:00.000Z',
      },
      { kind: 'word', text: '' },
    ])
    expect(rows).toHaveLength(1)
    const merged = mergeProductionProgress(rows, [
      { ...rows[0], attempts: 3, hits: 2, updatedAt: '2026-11-03T00:00:00.000Z' },
    ])
    expect(merged[0].attempts).toBe(3)
  })

  it('旧记录迁移：同文章/日期/模式/主题补同一个 sessionId', () => {
    const real = record()
    const base = {
      ...(real.task as unknown as Record<string, unknown>),
      sessionId: undefined,
    } as unknown as WritingRecord['task']
    const a = record({ task: base })
    const b = record({ at: '2026-11-01T11:00:00.000Z', task: { ...base, round: 2 } as unknown as WritingRecord['task'] })
    const old = [a, b]
    const { records, changed } = assignLegacyProductionSessionIds(old)
    expect(changed).toBe(2)
    const ids = records.map((r) => (r.task as { sessionId?: string }).sessionId)
    expect(ids[0]).toBeTruthy()
    expect(ids[0]).toBe(ids[1])
    expect(ids[0]).toContain('legacy:A|2026-11-01|full|工作')
  })

  it('旧记录没有 sessionId 时标成 legacy 分组', () => {
    const real = record()
    const legacy = record({
      task: {
        ...(real.task as unknown as Record<string, unknown>),
        sessionId: undefined,
      } as unknown as WritingRecord['task'],
    })
    const groups = groupProductionAttempts([legacy])
    expect(groups[0].legacy).toBe(true)
  })
})
