import { describe, expect, it } from 'vitest'
import { shouldDrill, type DrillInput } from './drill'

const idle: DrillInput = {
  active: true,
  spellMiss: false,
  learnPhase: false,
  parked: false,
  timedOut: false,
  relearnRevealed: false,
}

describe('shouldDrill：锤炼的触发条件', () => {
  it('什么都没发生 → 不锤炼', () => {
    expect(shouldDrill(idle)).toBe(false)
  })

  it('没在背 / 拼错判定 / 释义关进行中 → 不锤炼', () => {
    expect(shouldDrill({ ...idle, active: false, timedOut: true })).toBe(false)
    expect(shouldDrill({ ...idle, spellMiss: true, timedOut: true })).toBe(false)
    expect(shouldDrill({ ...idle, learnPhase: true, timedOut: true })).toBe(false)
  })

  it('卡停超时 → 锤炼', () => {
    expect(shouldDrill({ ...idle, timedOut: true })).toBe(true)
  })

  it('重学卡摊开释义 → 锤炼', () => {
    expect(shouldDrill({ ...idle, relearnRevealed: true })).toBe(true)
  })

  it('已判完停在卡上等「下一词」时，超时或重学都不抢（否则看不到单词卡）', () => {
    expect(shouldDrill({ ...idle, parked: true, timedOut: true })).toBe(false)
    expect(shouldDrill({ ...idle, parked: true, relearnRevealed: true })).toBe(false)
  })
})
