import { describe, it, expect } from 'vitest'
import { floatToWav } from './wav'

async function bytes(blob: Blob): Promise<DataView> {
  return new DataView(await blob.arrayBuffer())
}

describe('floatToWav', () => {
  it('写出的头是标准 16-bit PCM WAV', async () => {
    const wav = floatToWav([Float32Array.from([0, 0.5, -0.5, 1])], 8000)
    expect(wav.type).toBe('audio/wav')
    const v = await bytes(wav)
    const str = (off: number, n: number) =>
      Array.from({ length: n }, (_, i) => String.fromCharCode(v.getUint8(off + i))).join('')
    expect(str(0, 4)).toBe('RIFF')
    expect(str(8, 4)).toBe('WAVE')
    expect(str(12, 4)).toBe('fmt ')
    expect(str(36, 4)).toBe('data')
    expect(v.getUint16(20, true)).toBe(1) // PCM
    expect(v.getUint16(22, true)).toBe(1) // 单声道
    expect(v.getUint32(24, true)).toBe(8000)
    expect(v.getUint16(34, true)).toBe(16) // 位深
    // 4 帧 × 2 字节 + 44 头
    expect(wav.size).toBe(44 + 4 * 2)
    expect(v.getUint32(40, true)).toBe(4 * 2)
  })

  it('采样值按比例写进 data，正负都对', async () => {
    const wav = floatToWav([Float32Array.from([0, 0.5, -0.5])], 8000)
    const v = await bytes(wav)
    expect(v.getInt16(44 + 0, true)).toBe(0)
    expect(v.getInt16(44 + 2, true)).toBe(Math.round(0.5 * 0x7fff))
    expect(v.getInt16(44 + 4, true)).toBe(-0.5 * 0x8000)
  })

  it('超过 ±1 会夹住', async () => {
    const wav = floatToWav([Float32Array.from([2, -2])], 8000)
    const v = await bytes(wav)
    expect(v.getInt16(44, true)).toBe(0x7fff)
    expect(v.getInt16(46, true)).toBe(-0x8000)
  })

  it('多声道按帧交错', async () => {
    const wav = floatToWav([Float32Array.from([1, 0]), Float32Array.from([0, 1])], 44100)
    const v = await bytes(wav)
    expect(v.getUint16(22, true)).toBe(2) // 立体声
    expect(wav.size).toBe(44 + 2 * 2 * 2)
    expect(v.getInt16(44, true)).toBe(0x7fff) // L0
    expect(v.getInt16(46, true)).toBe(0) // R0
    expect(v.getInt16(48, true)).toBe(0) // L1
    expect(v.getInt16(50, true)).toBe(0x7fff) // R1
  })

  it('空声道也不炸', () => {
    expect(floatToWav([], 8000).size).toBe(44)
  })
})
