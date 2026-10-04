import { describe, it, expect } from 'vitest'
import {
  accuracy,
  addPracticeRecord,
  practiceByDay,
  recentPractice,
  sumByKind,
  sumPractice,
  type PracticeRecord,
} from './practice'

const rec = (at: string, total: number, correct: number): PracticeRecord => ({
  at,
  kind: 'quiz',
  total,
  correct,
})

describe('addPracticeRecord', () => {
  it('追加并保留最近 cap 条', () => {
    let list: PracticeRecord[] = []
    for (let i = 0; i < 5; i++) list = addPracticeRecord(list, rec('2026-10-0' + (i + 1), 10, i), 3)
    expect(list).toHaveLength(3)
    expect(list.map((r) => r.at)).toEqual(['2026-10-03', '2026-10-04', '2026-10-05'])
  })
})

describe('accuracy / recentPractice', () => {
  it('正确率', () => {
    expect(accuracy(rec('x', 4, 3))).toBeCloseTo(0.75, 5)
    expect(accuracy(rec('x', 0, 0))).toBe(0)
  })
  it('最近 n 条新的在前', () => {
    const list = [rec('a', 1, 1), rec('b', 1, 0), rec('c', 1, 1)]
    expect(recentPractice(list, 2).map((r) => r.at)).toEqual(['c', 'b'])
  })
})

describe('practiceByDay', () => {
  it('按天汇总', () => {
    const day = (iso: string) => iso.slice(0, 10)
    const m = practiceByDay([rec('2026-10-01T09:00:00Z', 4, 2), rec('2026-10-01T10:00:00Z', 6, 5), rec('2026-10-02T09:00:00Z', 2, 2)], day)
    expect(m.get('2026-10-01')).toEqual({ total: 10, correct: 7, count: 2 })
    expect(m.get('2026-10-02')).toEqual({ total: 2, correct: 2, count: 1 })
  })
})

describe('sumPractice / sumByKind', () => {
  it('合计与按类型', () => {
    const list: PracticeRecord[] = [
      { at: 'a', kind: 'quiz', total: 10, correct: 6 },
      { at: 'b', kind: 'dictation', total: 4, correct: 3 },
      { at: 'c', kind: 'quiz', total: 5, correct: 5 },
    ]
    expect(sumPractice(list)).toEqual({ total: 19, correct: 14 })
    expect(sumByKind(list)).toEqual({
      quiz: { total: 15, correct: 11 },
      dictation: { total: 4, correct: 3 },
      listening: { total: 0, correct: 0 },
    })
  })
})
