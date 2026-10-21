import { describe, expect, it } from 'vitest'
import {
  MAX_CARD_APPEARANCES,
  beginExtraRound,
  emptyExtraRound,
  planExtra,
  planRetryForgot,
} from './extra'

/**
 * 加练账本：每卡每轮最多 3 次、跨重练保留、过释义门禁不再追加、重练只发起一次。
 * 这组规则就是「一轮永远做不完」的止回阀，改了要同步 docs/TESTING.md。
 */
describe('beginExtraRound：新一轮的出场记账', () => {
  it('队列里每出现一次记 1 次；重练标记为未用', () => {
    const round = beginExtraRound(['a', 'b', 'a'])
    expect(round.appearances).toEqual({ a: 2, b: 1 })
    expect(round.retried).toBe(false)
    expect(emptyExtraRound()).toEqual({ appearances: {}, hardExtras: {}, retried: false })
  })
})

describe('planExtra：忘记 / 模糊之后的加练', () => {
  it('「忘记」一路加练到第 3 次出场，之后只写排期', () => {
    let round = beginExtraRound(['w1'])
    const first = planExtra(round, 'w1', 'again')
    expect(first.append).toBe(true)
    expect(first.blocked).toBeNull()
    expect(first.round.appearances.w1).toBe(2)

    const second = planExtra(first.round, 'w1', 'again')
    expect(second.append).toBe(true)
    expect(second.round.appearances.w1).toBe(MAX_CARD_APPEARANCES)

    const third = planExtra(second.round, 'w1', 'again')
    expect(third.append).toBe(false)
    expect(third.blocked).toBe('cap')
    expect(third.round).toBe(second.round) // 到上限不改账本
  })

  it('「模糊」只加练一次（没到总上限也不再追加，且不提示）', () => {
    const round = beginExtraRound(['w1'])
    const first = planExtra(round, 'w1', 'hard')
    expect(first.append).toBe(true)
    const second = planExtra(first.round, 'w1', 'hard')
    expect(second.append).toBe(false)
    expect(second.blocked).toBeNull()
    expect(second.round.appearances.w1).toBe(2)
  })

  it('认识 / 简单不追加，也不动账本', () => {
    const round = beginExtraRound(['w1'])
    for (const g of ['good', 'easy'] as const) {
      const d = planExtra(round, 'w1', g)
      expect(d.append).toBe(false)
      expect(d.blocked).toBeNull()
      expect(d.round).toBe(round)
    }
  })

  it('过了释义门禁的卡不再追加（总上限仍然优先）', () => {
    const round = beginExtraRound(['w1'])
    const gated = planExtra(round, 'w1', 'again', { gated: true })
    expect(gated.append).toBe(false)
    expect(gated.blocked).toBe('gate')
    expect(gated.round.appearances.w1).toBe(1)

    const capped = beginExtraRound(['w1', 'w1', 'w1'])
    expect(planExtra(capped, 'w1', 'again', { gated: true }).blocked).toBe('cap')
  })

  it('没登记过的卡也能算（按 0 次出场起步）', () => {
    const d = planExtra(emptyExtraRound(), 'x', 'again')
    expect(d.append).toBe(true)
    expect(d.round.appearances.x).toBe(1)
  })
})

describe('planRetryForgot：重练忘记的', () => {
  it('进重练的卡记一次出场；本轮第二次发起被拒', () => {
    const round = beginExtraRound(['w1', 'w2'])
    const plan = planRetryForgot(round, ['w2', 'w1', 'w2'])
    expect(plan.blocked).toBe(false)
    expect(plan.ids).toEqual(['w2', 'w1']) // 去重，保持传入顺序
    expect(plan.capped).toBe(0)
    expect(plan.round.appearances).toEqual({ w1: 2, w2: 2 })
    expect(plan.round.retried).toBe(true)

    const again = planRetryForgot(plan.round, ['w1'])
    expect(again.blocked).toBe(true)
    expect(again.ids).toEqual([])
    expect(again.round).toBe(plan.round)
  })

  it('已练满 3 次的卡不再进重练队列，条数单独报出来', () => {
    const round = beginExtraRound(['w1', 'w2'])
    const plan = planRetryForgot(round, ['w1', 'w2'])
    expect(plan.ids).toEqual(['w1', 'w2'])

    const full = planRetryForgot(plan.round, ['w1', 'w2']) // 已经被拒（retried）
    expect(full.blocked).toBe(true)

    // 构造「三条出场 + 未重练」的局面
    let r = beginExtraRound(['w3'])
    r = planExtra(r, 'w3', 'again').round
    r = planExtra(r, 'w3', 'again').round
    const mixed = planRetryForgot(r, ['w3'])
    expect(mixed.ids).toEqual([])
    expect(mixed.capped).toBe(1)
    expect(mixed.blocked).toBe(false)
    expect(mixed.round.retried).toBe(true) // 点过一次就不再给按钮
  })
})

describe('加练循环一定收敛', () => {
  it('一直点「忘记了」也只追加 2 次；重练一次后再点不再追加', () => {
    let round = beginExtraRound(['w1'])
    let appended = 0
    for (let i = 0; i < 20; i += 1) {
      const d = planExtra(round, 'w1', 'again')
      round = d.round
      if (d.append) appended += 1
    }
    expect(appended).toBe(MAX_CARD_APPEARANCES - 1)

    const retry = planRetryForgot(beginExtraRound(['w1']), ['w1'])
    expect(retry.ids).toEqual(['w1'])
    let after = retry.round
    let extra = 0
    for (let i = 0; i < 20; i += 1) {
      const d = planExtra(after, 'w1', 'again')
      after = d.round
      if (d.append) extra += 1
    }
    expect(extra).toBe(MAX_CARD_APPEARANCES - 2) // 重练已经占掉一次出场
    expect(after.appearances.w1).toBe(MAX_CARD_APPEARANCES)
  })
})
