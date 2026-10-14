import { describe, it, expect } from 'vitest'
import { buildOutputBoard, type OutputInput } from './output'

const base = (over: Partial<OutputInput> = {}): OutputInput => ({
  chunkStats: { total: 0, correct: 0 },
  grammarStats: { total: 0, correct: 0 },
  words: { total: 10, withChunks: 10, studied: 10, stable: 8 },
  writes: { count: 0, avgScore: null },
  retells: { count: 0, words: 0 },
  streak: 0,
  ...over,
})

describe('buildOutputBoard', () => {
  it('全空 → 还没产出，下一步是建生词', () => {
    const b = buildOutputBoard(
      base({ words: { total: 0, withChunks: 0, studied: 0, stable: 0 } }),
    )
    expect(b.grade).toBe('还没产出')
    expect(b.score).toBe(0)
    expect(b.next).toContain('先建生词')
  })

  it('有词块但没测过 → 建议先做词块拷打', () => {
    const b = buildOutputBoard(base())
    expect(b.next).toContain('词块拷打')
    expect(b.rows.find((r) => r.key === 'chunkAcc')?.value).toBe('还没测过')
  })

  it('词块正确率会被量化', () => {
    const b = buildOutputBoard(base({ chunkStats: { total: 10, correct: 8 } }))
    expect(b.rows.find((r) => r.key === 'chunkAcc')?.value).toContain('80%')
    expect(b.rows.find((r) => r.key === 'chunkAcc')?.good).toBe(true)
  })

  it('没产出时分数低；产出拉高分数', () => {
    const none = buildOutputBoard(base({ chunkStats: { total: 20, correct: 18 } })).score
    const withOutput = buildOutputBoard(
      base({
        chunkStats: { total: 20, correct: 18 },
        writes: { count: 2, avgScore: 85 },
        retells: { count: 1, words: 100 },
        streak: 5,
      }),
    ).score
    expect(withOutput).toBeGreaterThan(none)
    expect(buildOutputBoard(
      base({
        chunkStats: { total: 20, correct: 18 },
        writes: { count: 3, avgScore: 88 },
        retells: { count: 2, words: 150 },
        streak: 7,
      }),
    ).grade).toBe('实打实')
  })

  it('顺序：仿写在复述之前（先写再复述）', () => {
    const b = buildOutputBoard(base({ chunkStats: { total: 5, correct: 5 }, writes: { count: 0, avgScore: null } }))
    expect(b.next).toContain('仿写')
    const b2 = buildOutputBoard(
      base({ chunkStats: { total: 5, correct: 5 }, writes: { count: 1, avgScore: 80 }, retells: { count: 0, words: 0 } }),
    )
    expect(b2.next).toContain('复述')
  })

  it('rows 覆盖七个指标', () => {
    const b = buildOutputBoard(base())
    expect(b.rows.map((r) => r.key)).toEqual([
      'chunkAcc',
      'grammarAcc',
      'chunkCover',
      'write',
      'retell',
      'memory',
      'streak',
    ])
  })
})
