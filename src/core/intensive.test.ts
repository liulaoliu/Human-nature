import { describe, it, expect } from 'vitest'
import { buildIntensivePlan, type IntensiveInput } from './intensive'

const words = (over: Partial<IntensiveInput['words']> = {}) => ({
  total: 10,
  withMeaning: 10,
  withChunks: 10,
  withMarks: 8,
  studied: 10,
  stable: 6,
  due: 0,
  noExample: 0,
  ...over,
})

const base = (over: Partial<IntensiveInput> = {}): IntensiveInput => ({
  hasDoc: true,
  skimmed: true,
  words: words(),
  sentences: { total: 10, translated: 10, language: 10 },
  quiz: { total: 20, correct: 18 },
  writes: 1,
  ...over,
})

describe('buildIntensivePlan', () => {
  it('空文章：全是 todo，等级 0', () => {
    const plan = buildIntensivePlan({ hasDoc: false, skimmed: false, words: words({ total: 0 }), sentences: { total: 0, translated: 0, language: 0 }, writes: 0 })
    expect(plan.level).toBe(0)
    expect(plan.stages.every((s) => s.status === 'todo')).toBe(true)
    expect(plan.stages).toHaveLength(7)
  })

  it('只通读 → 及格，下一步是标词/查词', () => {
    const plan = buildIntensivePlan(
      base({ words: words({ total: 0 }), sentences: { total: 0, translated: 0, language: 0 }, quiz: undefined, writes: 0 }),
    )
    expect(plan.stages.find((s) => s.key === 'skim')?.status).toBe('done')
    expect(plan.level).toBe(0)
    expect(plan.levelLabel).toBe('及格')
    expect(plan.nextKey).toBe('vocab')
  })

  it('词/句都齐 + 考过 → 达标', () => {
    const plan = buildIntensivePlan(base({ writes: 0, words: words({ studied: 5, stable: 2 }) }))
    expect(plan.level).toBe(1)
    expect(plan.levelLabel).toBe('达标')
  })

  it('仿写过 → 产出', () => {
    const plan = buildIntensivePlan(base({ words: words({ studied: 5, stable: 2 }) }))
    expect(plan.level).toBe(2)
    expect(plan.levelLabel).toBe('产出')
  })

  it('全部到位 → 精通', () => {
    const plan = buildIntensivePlan(base())
    expect(plan.level).toBe(3)
    expect(plan.levelLabel).toBe('精通')
    expect(plan.nextKey).toBeNull()
    expect(plan.progress).toBe(100)
  })

  it('达标拷打要学过全部词、且正确率 >= 80%', () => {
    const low = buildIntensivePlan(base({ quiz: { total: 10, correct: 5 } }))
    expect(low.stages.find((s) => s.key === 'recall')?.status).not.toBe('done')
    const ok = buildIntensivePlan(base({ quiz: { total: 10, correct: 9 } }))
    expect(ok.stages.find((s) => s.key === 'recall')?.status).toBe('done')
  })

  it('下一步取第一个未完成阶段', () => {
    const plan = buildIntensivePlan(base({ words: words({ withChunks: 3 }) }))
    expect(plan.nextKey).toBe('chunks')
    expect(plan.nextLabel).toContain('词块')
  })
})
