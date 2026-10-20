import { describe, it, expect } from 'vitest'
import { NOISE_FLOOR_INIT, VOICE_MARGIN, recordCapMs, voiceThreshold } from './recording'

describe('recordCapMs', () => {
  it('短块按「两倍块长 + 3 秒」给，留够慢慢读的余地', () => {
    expect(recordCapMs(3)).toBe(9000)
  })

  it('再短的块也至少给 4 秒（块只有 0.2 秒也不至于一句都读不完）', () => {
    expect(recordCapMs(0)).toBe(4000)
    expect(recordCapMs(0.1)).toBe(4000)
  })

  it('长块封顶 90 秒：静音检测失灵时总得能自己停下来', () => {
    expect(recordCapMs(60)).toBe(90000)
    expect(recordCapMs(600)).toBe(90000)
  })
})

describe('voiceThreshold', () => {
  it('底噪为 0 时取「0 + 余量」，不是 0 —— 否则房间里的杂音都算说话', () => {
    expect(voiceThreshold(0)).toBe(VOICE_MARGIN)
  })

  it('底噪高时跟着往上抬（小增益设备的底噪本来就高）', () => {
    expect(voiceThreshold(0.02)).toBeCloseTo(0.02 + VOICE_MARGIN, 10)
  })

  it('开录初值下阈值 = 初值底噪 + 余量（比刚开录的底噪高，先保守）', () => {
    expect(voiceThreshold(NOISE_FLOOR_INIT)).toBeCloseTo(NOISE_FLOOR_INIT + VOICE_MARGIN, 10)
  })

  it('可以覆盖绝对下限（会话里让 deps.voiceLevel 优先）', () => {
    expect(voiceThreshold(0, 0.05)).toBe(0.05)
    expect(voiceThreshold(0.1, 0.05)).toBeCloseTo(0.1 + VOICE_MARGIN, 10)
  })
})
