import { describe, expect, it } from 'vitest'
import { drillReason, shouldDrill, type DrillInput } from './drill'

const idle: DrillInput = {
  active: true,
  spellMiss: false,
  learnPhase: false,
  parked: false,
  timedOut: false,
  relearnScoring: false,
  cleared: false,
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

  it('重学卡正要评分 → 锤炼（评分门禁）', () => {
    expect(shouldDrill({ ...idle, relearnScoring: true })).toBe(true)
  })

  it('已判完停在卡上等「下一词」时，超时或重学都不抢（否则看不到单词卡）', () => {
    expect(shouldDrill({ ...idle, parked: true, timedOut: true })).toBe(false)
    expect(shouldDrill({ ...idle, parked: true, relearnScoring: true })).toBe(false)
  })

  it('本轮已经锤炼过 → 不再拦（重学卡摊开过就一直是摊开，否则面板原地重开退不出去）', () => {
    expect(shouldDrill({ ...idle, cleared: true, relearnScoring: true })).toBe(false)
    expect(shouldDrill({ ...idle, cleared: true, timedOut: true })).toBe(false)
  })
})

describe('drillReason：两种锤炼的来路要分得开', () => {
  it('没触发 → null', () => {
    expect(drillReason(idle)).toBeNull()
  })

  it('卡停超时 → timeout（界面写「超时锤炼」）', () => {
    expect(drillReason({ ...idle, timedOut: true })).toBe('timeout')
  })

  it('重学卡正要评分 → relearn（界面写「重学补考」）', () => {
    expect(drillReason({ ...idle, relearnScoring: true })).toBe('relearn')
  })

  it('两条同时成立 → 报 timeout（更早发生、更好解释）', () => {
    expect(drillReason({ ...idle, timedOut: true, relearnScoring: true })).toBe('timeout')
  })

  it('被前置条件挡住时不管哪条触发都返回 null', () => {
    const blocked: DrillInput[] = [
      { ...idle, active: false, timedOut: true },
      { ...idle, spellMiss: true, relearnScoring: true },
      { ...idle, learnPhase: true, timedOut: true },
      { ...idle, parked: true, relearnScoring: true },
      { ...idle, cleared: true, timedOut: true },
    ]
    for (const input of blocked) expect(drillReason(input)).toBeNull()
  })
})
