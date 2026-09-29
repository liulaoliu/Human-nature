import { describe, it, expect } from 'vitest'
import { speechRms, matchGain, applyGain, peakSafeGain } from './loudness'
import { buildSignal } from './testSignals'

/** 恒定振幅的方波，方便精确断言 RMS = amplitude */
function constWave(amplitude: number, sec: number, sampleRate = 8000): Float32Array {
  const out = new Float32Array(Math.round(sec * sampleRate))
  for (let i = 0; i < out.length; i++) out[i] = i % 2 === 0 ? amplitude : -amplitude
  return out
}

describe('speechRms', () => {
  it('全静音返 0', () => {
    expect(speechRms(new Float32Array(8000), 8000)).toBe(0)
  })

  it('恒定振幅的信号，能量约等于振幅', () => {
    const level = speechRms(constWave(0.5, 1), 8000)
    expect(level).toBeCloseTo(0.5, 2)
  })

  it('振幅翻倍，能量也翻倍', () => {
    const a = speechRms(constWave(0.2, 1), 8000)
    const b = speechRms(constWave(0.4, 1), 8000)
    expect(b / a).toBeCloseTo(2, 1)
  })

  it('静音包着一段有声，能量看的是有声那段，不被静音拉低', () => {
    const sr = 8000
    const samples = new Float32Array(sr * 3)
    // 中间 1 秒 0.4，两头是 0
    for (let i = sr; i < sr * 2; i++) samples[i] = i % 2 === 0 ? 0.4 : -0.4
    const level = speechRms(samples, sr)
    expect(level).toBeGreaterThan(0.3)
  })

  it('空采样不炸', () => {
    expect(speechRms(new Float32Array(0), 8000)).toBe(0)
    expect(speechRms(new Float32Array(4), 0)).toBe(0)
  })
})

describe('matchGain', () => {
  it('take 比标准小 5 倍，就放大 5 倍', () => {
    expect(matchGain(0.5, 0.1)).toBeCloseTo(5, 5)
  })

  it('take 比标准响就衰减', () => {
    expect(matchGain(0.3, 0.5)).toBeCloseTo(0.6, 5)
  })

  it('一样亮就不动', () => {
    expect(matchGain(0.3, 0.3)).toBeCloseTo(1, 5)
  })

  it('夹在上下限之间，防止爆音或把噪声也放大', () => {
    expect(matchGain(1, 0.01)).toBe(10)
    expect(matchGain(0.01, 1)).toBe(0.5)
  })

  it('任一侧测不出就不动增益', () => {
    expect(matchGain(0, 0.3)).toBe(1)
    expect(matchGain(0.3, 0)).toBe(1)
  })
})

describe('applyGain / peakSafeGain', () => {
  it('整体乘增益', () => {
    const out = applyGain(Float32Array.from([0.1, -0.2, 0.3]), 2)
    expect(out[0]).toBeCloseTo(0.2, 5)
    expect(out[1]).toBeCloseTo(-0.4, 5)
    expect(out[2]).toBeCloseTo(0.6, 5)
  })

  it('超过 ±1 会夹住，不溢出', () => {
    const out = applyGain(Float32Array.from([0.8, -0.9]), 5)
    expect(out[0]).toBe(1)
    expect(out[1]).toBe(-1)
  })

  it('peakSafeGain 不让峰值越过 0.99', () => {
    const ch = [Float32Array.from([0.5, -0.3])]
    expect(peakSafeGain(ch, 10)).toBeCloseTo(0.99 / 0.5, 5)
    // 想要的增益更小就照用
    expect(peakSafeGain(ch, 1.2)).toBe(1.2)
  })

  it('peakSafeGain 对全静音不设限', () => {
    expect(peakSafeGain([new Float32Array(8)], 8)).toBe(8)
  })
})

describe('speechRms 在真实测试信号上', () => {
  it('更响的信号能量更大', () => {
    const quiet = buildSignal([['speech', 1]], 8000, 1).samples
    const loud = Float32Array.from(quiet, (v) => v * 2)
    expect(speechRms(loud, 8000)).toBeGreaterThan(speechRms(quiet, 8000))
  })
})
