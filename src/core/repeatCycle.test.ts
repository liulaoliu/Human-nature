import { describe, expect, it } from 'vitest'
import { REPEAT_IDLE, loopLabel, repeatNext, repeatStepLabel, type RepeatState } from './repeatCycle'

const ref: RepeatState = { step: 'ref' }
const rec: RepeatState = { step: 'rec' }
const take: RepeatState = { step: 'take' }

describe('repeatNext：标准音 → 录音 → 回放 → 下一句', () => {
  it('start 从 idle 进入听标准音', () => {
    expect(repeatNext(REPEAT_IDLE, 'start', { hasNext: true })).toEqual({
      state: ref,
      action: 'playRef',
    })
  })

  it('标准音播完开始录音', () => {
    expect(repeatNext(ref, 'refEnd', { hasNext: true })).toEqual({
      state: rec,
      action: 'startRec',
    })
  })

  it('录音结束回放我的', () => {
    expect(repeatNext(rec, 'recEnd', { hasNext: true })).toEqual({
      state: take,
      action: 'playTake',
    })
  })

  it('回放完还有下一句 → next；最后一句 → 停', () => {
    expect(repeatNext(take, 'takeEnd', { hasNext: true })).toEqual({ state: ref, action: 'next' })
    expect(repeatNext(take, 'takeEnd', { hasNext: false })).toEqual({
      state: REPEAT_IDLE,
      action: 'stop',
    })
  })

  it('stop / fail 一律回 idle', () => {
    for (const state of [ref, rec, take]) {
      expect(repeatNext(state, 'stop', { hasNext: true }).action).toBe('stop')
      expect(repeatNext(state, 'fail', { hasNext: true }).state).toEqual(REPEAT_IDLE)
    }
  })

  it('乱序事件不改状态', () => {
    expect(repeatNext(ref, 'recEnd', { hasNext: true })).toEqual({ state: ref, action: 'none' })
    expect(repeatNext(REPEAT_IDLE, 'takeEnd', { hasNext: true }).action).toBe('none')
  })

  it('状态字只在进行中有内容', () => {
    expect(repeatStepLabel('idle')).toBe('')
    expect(repeatStepLabel('rec')).toContain('录音')
  })

  it('循环档位文案：0 是不限', () => {
    expect(loopLabel(0)).toBe('不限')
    expect(loopLabel(3)).toBe('3 遍')
  })
})
