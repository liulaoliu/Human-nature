import { describe, expect, it } from 'vitest'
import { beginExtraRound, emptyExtraRound, planExtra, planRetryForgot } from './extra'

/**
 * 加练账本：忘记无上限地重排、模糊/认识收尾、重练每轮只发起一次。
 * 这组规则决定「一轮什么时候结束」，改了要同步 docs/TESTING.md。
 */
describe('beginExtraRound：新一轮的出场记账', () => {
  it('队列里每出现一次记 1 次；重练标记为未用', () => {
    const round = beginExtraRound(['a', 'b', 'a'])
    expect(round.appearances).toEqual({ a: 2, b: 1 })
    expect(round.retried).toBe(false)
    expect(emptyExtraRound()).toEqual({ appearances: {}, retried: false })
  })
})

describe('planExtra：忘记一直追加，模糊/认识收尾', () => {
  it('连续评「忘记了」不封顶：每次追加，出场数一直涨', () => {
    let round = beginExtraRound(['w1'])
    for (let n = 2; n <= 8; n++) {
      const d = planExtra(round, 'w1', 'again')
      expect(d.append).toBe(true)
      expect(d.round.appearances.w1).toBe(n)
      round = d.round
    }
  })

  it('「模糊」是收尾条件：不再追加，也不动账本', () => {
    const round = beginExtraRound(['w1'])
    const d = planExtra(round, 'w1', 'hard')
    expect(d.append).toBe(false)
    expect(d.round).toBe(round)
    expect(d.round.appearances.w1).toBe(1)
  })

  it('认识 / 简单同样不追加', () => {
    const round = beginExtraRound(['w1'])
    for (const g of ['good', 'easy'] as const) {
      const d = planExtra(round, 'w1', g)
      expect(d.append).toBe(false)
      expect(d.round).toBe(round)
    }
  })

  it('没登记过的卡也能算（按 0 次出场起步）', () => {
    const d = planExtra(emptyExtraRound(), 'x', 'again')
    expect(d.append).toBe(true)
    expect(d.round.appearances.x).toBe(1)
  })
})

describe('planRetryForgot：重练忘记的', () => {
  it('忘记过的词全部进重练（不按旧上限剔除），去重并记一次出场', () => {
    const round = beginExtraRound(['w1', 'w2'])
    const d = planRetryForgot(round, ['w1', 'w2', 'w1'])
    expect(d.blocked).toBe(false)
    expect(d.ids).toEqual(['w1', 'w2'])
    expect(d.round.appearances.w1).toBe(2)
    expect(d.round.appearances.w2).toBe(2)
    expect(d.round.retried).toBe(true)
  })

  it('每轮只发起一次', () => {
    const first = planRetryForgot(beginExtraRound(['w1']), ['w1'])
    const second = planRetryForgot(first.round, ['w1'])
    expect(second.blocked).toBe(true)
    expect(second.ids).toEqual([])
    expect(second.round).toBe(first.round)
  })
})
