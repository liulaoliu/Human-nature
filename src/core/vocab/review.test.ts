import { describe, it, expect } from 'vitest'
import {
  buildLearnQueue,
  buildReviewQueue,
  buildStudyQueue,
  dueItems,
  isDue,
  nextDayIso,
  review,
  reviewItem,
} from './review'
import { createLibrary, isPriority, prioritizeItems } from './library'
import { markWord } from './analysis'
import { vocabItem } from '../testFixtures'

const NOW = new Date('2026-10-02T00:00:00.000Z')
const item = vocabItem

describe('复习排期（SM-2 变体）', () => {
  const fresh = { ease: 2.5, due: null as string | null, interval: 0, repetitions: 0 }

  it('第一次 good：1 天后', () => {
    const r = review(fresh, 'good', NOW)
    expect(r.repetitions).toBe(1)
    expect(r.interval).toBe(1)
    expect(r.due).toBe('2026-10-03T00:00:00.000Z')
  })
  it('第二次 good：6 天后', () => {
    const r = review({ ease: 2.5, due: null, interval: 1, repetitions: 1 }, 'good', NOW)
    expect(r.interval).toBe(6)
  })
  it('第三次 good：interval × ease', () => {
    const r = review({ ease: 2.5, due: null, interval: 6, repetitions: 2 }, 'good', NOW)
    expect(r.interval).toBe(15)
  })
  it('easy 提高 ease', () => {
    const r = review(fresh, 'easy', NOW)
    expect(r.ease).toBeCloseTo(2.6, 5)
  })
  it('again 重来：repetitions 归零、间隔 1 天、ease 下降', () => {
    const r = review({ ease: 2.5, due: null, interval: 15, repetitions: 3 }, 'again', NOW)
    expect(r.repetitions).toBe(0)
    expect(r.interval).toBe(1)
    expect(r.ease).toBeCloseTo(2.3, 5)
  })
  it('ease 下限 1.3', () => {
    const r = review({ ease: 1.3, due: null, interval: 1, repetitions: 1 }, 'again', NOW)
    expect(r.ease).toBe(1.3)
  })
  it('reviewItem 写回词条', () => {
    let lib = markWord(createLibrary(), { word: 'run', articleId: 'a1' }, NOW).library
    lib = reviewItem(lib, lib.items[0].id, 'good', NOW)
    expect(lib.items[0].reviewState.repetitions).toBe(1)
  })
  it('isDue / dueItems', () => {
    const due = item({ id: 'vocab:d', lemma: 'due', reviewState: { ease: 2.5, due: '2026-09-01T00:00:00.000Z', interval: 1, repetitions: 1 } })
    const future = item({ id: 'vocab:e', lemma: 'future', reviewState: { ease: 2.5, due: '2027-01-01T00:00:00.000Z', interval: 1, repetitions: 1 } })
    expect(isDue(due, NOW)).toBe(true)
    expect(isDue(future, NOW)).toBe(false)
    expect(dueItems([future, due], NOW).map((x) => x.lemma)).toEqual(['due'])
  })
})
describe('出错加权（lapses）', () => {
  it('评「忘记」累计 lapses，其它评分保持', () => {
    const base = { ease: 2.5, due: null, interval: 1, repetitions: 1, lapses: 2 }
    expect(review(base, 'again').lapses).toBe(3)
    expect(review(base, 'good').lapses).toBe(2)
  })
  it('老数据没有 lapses 时按 0 起算', () => {
    expect(review({ ease: 2.5, due: null, interval: 1, repetitions: 1 }, 'again').lapses).toBe(1)
  })
})
describe('优先重排（答错 → 次日排最前）', () => {
  const now = new Date('2026-10-02T00:00:00Z')
  const due = (id: string) =>
    item({ id, lemma: id, reviewState: { ease: 2.5, due: '2026-10-02T00:00:00Z', interval: 3, repetitions: 2 } })

  it('prioritizeItems 只标记指定词条', () => {
    const lib = { schemaVersion: 1, items: [due('a'), due('b')] }
    const out = prioritizeItems(lib, ['a'], nextDayIso(now))
    expect(out.items.find((x) => x.id === 'a')?.priorityUntil).toBe('2026-10-03T00:00:00.000Z')
    expect(out.items.find((x) => x.id === 'b')?.priorityUntil).toBeUndefined()
  })

  it('isPriority 未过期才算', () => {
    expect(isPriority({ priorityUntil: '2026-10-03T00:00:00Z' } as any, now)).toBe(true)
    expect(isPriority({ priorityUntil: '2026-10-01T00:00:00Z' } as any, now)).toBe(false)
    expect(isPriority({} as any, now)).toBe(false)
  })

  it('复习队列把「优先」排到最前', () => {
    const prio = { ...due('p'), priorityUntil: '2026-10-03T00:00:00Z' }
    const plain = { ...due('n'), reviewState: { ...due('n').reviewState, due: '2026-10-01T00:00:00Z' } }
    const q = buildReviewQueue([plain, prio], now)
    expect(q.map((x) => x.id)).toEqual(['p', 'n'])
  })

  it('学习队列同样优先', () => {
    const prio = { ...due('p'), priorityUntil: '2026-10-03T00:00:00Z' }
    const plain = due('n')
    expect(buildStudyQueue([plain, prio], now).map((x) => x.id)).toEqual(['p', 'n'])
  })
})

describe('buildStudyQueue 出场顺序', () => {
  it('学习队列：到期 → 新词 → 其它', () => {
    const now = new Date('2026-10-02T00:00:00Z')
    const due = item({ id: 'd', lemma: 'due', reviewState: { ease: 2.5, due: '2026-09-01T00:00:00Z', interval: 1, repetitions: 2 } })
    const fresh = item({ id: 'f', lemma: 'fresh', reviewState: { ease: 2.5, due: null, interval: 0, repetitions: 0 } })
    const later = item({ id: 'l', lemma: 'later', reviewState: { ease: 2.5, due: '2027-01-01T00:00:00Z', interval: 5, repetitions: 3 } })
    expect(buildStudyQueue([later, fresh, due], now).map((x) => x.lemma)).toEqual(['due', 'fresh', 'later'])
  })
})

describe('每日新词配额', () => {
  const now = new Date('2026-10-02T00:00:00Z')
  const fresh = (n: number) =>
    item({ id: `f${n}`, lemma: `f${n}`, reviewState: { ease: 2.5, due: null, interval: 0, repetitions: 0 } })
  it('限制新词数量', () => {
    expect(buildStudyQueue([fresh(1), fresh(2), fresh(3)], now, { newLimit: 2, newToday: 0 })).toHaveLength(2)
  })
  it('当天额度用完就不出新词', () => {
    expect(buildStudyQueue([fresh(1), fresh(2)], now, { newLimit: 2, newToday: 2 })).toHaveLength(0)
  })
  it('不限时不裁剪', () => {
    expect(buildStudyQueue([fresh(1), fresh(2), fresh(3)], now, { newLimit: 0 })).toHaveLength(3)
  })
})
describe('新学习 / 复习 两种队列', () => {
  const now = new Date('2026-10-02T00:00:00Z')
  const fresh = (n: string) =>
    item({ id: `f${n}`, lemma: `f${n}`, reviewState: { ease: 2.5, due: null, interval: 0, repetitions: 0 } })
  const learned = (n: string, due: string, reps = 2) =>
    item({ id: `l${n}`, lemma: `l${n}`, reviewState: { ease: 2.5, due, interval: 3, repetitions: reps } })

  it('新学习：只取没学过的', () => {
    const q = buildLearnQueue([learned('a', '2026-09-01T00:00:00Z'), fresh('b'), fresh('c')], now)
    expect(q.map((x) => x.lemma)).toEqual(['fb', 'fc'])
  })
  it('新学习：受每日配额限制', () => {
    expect(buildLearnQueue([fresh('a'), fresh('b'), fresh('c')], now, { newLimit: 2, newToday: 1 })).toHaveLength(1)
  })
  it('复习：只取已学过且到期的，按到期升序', () => {
    const q = buildReviewQueue(
      [
        learned('later', '2026-12-01T00:00:00Z'),
        learned('overdue', '2026-09-01T00:00:00Z'),
        fresh('new'),
        learned('yesterday', '2026-10-01T00:00:00Z'),
      ],
      now,
    )
    expect(q.map((x) => x.lemma)).toEqual(['loverdue', 'lyesterday'])
  })
  it('复习：没到期 / 没学过的不进队', () => {
    expect(buildReviewQueue([fresh('a'), learned('b', '2027-01-01T00:00:00Z')], now)).toHaveLength(0)
  })
})
