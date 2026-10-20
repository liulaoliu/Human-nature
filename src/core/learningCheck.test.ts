import { describe, expect, it } from 'vitest'
import { emptyLearning, type LearningData } from './learning'
import { compareDerived, describeLearningCheck, sumActivityCats, sumKindStats } from './learningCheck'

function make(patch: Partial<LearningData> = {}): LearningData {
  return { ...emptyLearning(), ...patch }
}

describe('sumActivityCats', () => {
  it('同类活动跨天累加；坏计数当 0，不产生 NaN', () => {
    const cats = sumActivityCats([
      { day: '2026-10-19', counts: { vocab: 3, read: 1 } },
      { day: '2026-10-20', counts: { vocab: 2, listen: 4 } },
      // 坏数据：负数 / 非数字
      { day: '2026-10-21', counts: { vocab: -5, write: 'x' as unknown as number } },
    ])
    expect(cats.vocab).toBe(5)
    expect(cats.read).toBe(1)
    expect(cats.listen).toBe(4)
    expect(cats.write).toBe(0)
    expect(cats.speak).toBe(0)
  })

  it('空列表 / 脏行不炸', () => {
    expect(sumActivityCats([])).toEqual({ read: 0, vocab: 0, listen: 0, write: 0, speak: 0 })
    // 运行时收到 null 行（旧备份）也不能抛
    expect(sumActivityCats([null as never, { day: 'x' } as never]).vocab).toBe(0)
  })
})

describe('sumKindStats', () => {
  it('所有文章、所有题型相加', () => {
    expect(
      sumKindStats({
        a1: { spell: { total: 4, correct: 3 }, cloze: { total: 2, correct: 2 } },
        a2: { spell: { total: 1, correct: 0 } },
      }),
    ).toEqual({ total: 7, correct: 5 })
  })

  it('坏值不参与累计', () => {
    expect(sumKindStats({ a1: { spell: { total: 'x' as unknown as number, correct: -1 } } })).toEqual({
      total: 0,
      correct: 0,
    })
  })
})

describe('compareDerived', () => {
  it('两份一样时 matched，7 行全 0 差', () => {
    const data = make({
      activity: [{ day: '2026-10-20', counts: { vocab: 3, listen: 1 } }],
      kindStats: { a1: { spell: { total: 4, correct: 3 } } },
    })
    const res = compareDerived(data, data)
    expect(res.matched).toBe(true)
    expect(res.mismatched).toEqual([])
    // 5 类活动 + 题量 + 答对
    expect(res.rows.map((r) => r.key)).toEqual([
      'activity:read',
      'activity:vocab',
      'activity:listen',
      'activity:write',
      'activity:speak',
      'kind:total',
      'kind:correct',
    ])
    expect(res.localActivityTotal).toBe(4)
    expect(res.serverActivityTotal).toBe(4)
  })

  it('只报不一致的行，diff 是「服务端 − 本地」', () => {
    const local = make({ activity: [{ day: '2026-10-20', counts: { vocab: 5 } }] })
    const server = make({ activity: [{ day: '2026-10-20', counts: { vocab: 8 } }] })
    const res = compareDerived(local, server)
    expect(res.matched).toBe(false)
    expect(res.mismatched).toHaveLength(1)
    expect(res.mismatched[0]).toMatchObject({ key: 'activity:vocab', local: 5, server: 8, diff: 3 })
  })

  it('题型统计差在题量/答对上分别报', () => {
    const local = make({ kindStats: { a1: { spell: { total: 4, correct: 3 } } } })
    const server = make({ kindStats: { a1: { spell: { total: 4, correct: 1 } } } })
    const res = compareDerived(local, server)
    expect(res.mismatched.map((r) => r.key)).toEqual(['kind:correct'])
    expect(res.mismatched[0].diff).toBe(-2)
  })

  it('服务端重建为空（事件丢了）也能报出差异，不会抛', () => {
    const local = make({ activity: [{ day: '2026-10-20', counts: { vocab: 2 } }] })
    const res = compareDerived(local, emptyLearning())
    expect(res.matched).toBe(false)
    expect(res.mismatched[0]).toMatchObject({ key: 'activity:vocab', server: 0 })
  })
})

describe('describeLearningCheck', () => {
  it('一致时给出总量', () => {
    const data = make({
      activity: [{ day: '2026-10-20', counts: { vocab: 3, listen: 1 } }],
      kindStats: { a1: { spell: { total: 4, correct: 3 } } },
    })
    expect(describeLearningCheck(compareDerived(data, data))).toBe('核对一致：活动 4 次 · 答题 4 道')
  })

  it('不一致时最多列 3 项，其余折成「另 N 项」', () => {
    const local = emptyLearning()
    const server = make({
      activity: [{ day: '2026-10-20', counts: { vocab: 1, read: 1, listen: 1, write: 1, speak: 1 } }],
      kindStats: { a1: { spell: { total: 9, correct: 9 } } },
    })
    const text = describeLearningCheck(compareDerived(local, server))
    expect(text).toContain('核对发现 7 项不一致')
    expect(text).toContain('活动·词 本地 0 / 服务端 1')
    expect(text).toContain('另 4 项')
  })
})
