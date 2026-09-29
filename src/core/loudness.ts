/**
 * 响度匹配：让「我的录音」回放时和标准音一样响。
 *
 * 不做压缩/限幅，只算一个整体增益。用「像说话那部分的 RMS」而不是全段 RMS
 * 或峰值：全段会把静音也算进去（录音前后都有静音，标准音句子之间也有停顿），
 * 峰值则会被一个爆音带偏。分帧 RMS 里取够响的那些帧平均，比较接近听感。
 */

/** 分帧 RMS 里「像说话」那部分的平均能量（0..1）。全静音返回 0 */
export function speechRms(samples: Float32Array, sampleRate: number, frameMs = 20): number {
  if (samples.length === 0 || sampleRate <= 0) return 0
  const frameLen = Math.max(1, Math.round((sampleRate * frameMs) / 1000))
  if (samples.length < frameLen) return 0

  const rms: number[] = []
  let maxR = 0
  for (let start = 0; start + frameLen <= samples.length; start += frameLen) {
    let acc = 0
    for (let i = 0; i < frameLen; i++) {
      const v = samples[start + i]
      acc += v * v
    }
    const r = Math.sqrt(acc / frameLen)
    rms.push(r)
    if (r > maxR) maxR = r
  }
  if (maxR <= 0) return 0

  // 只算能量在最大帧 20% 以上的帧，躲开静音和零星噪声
  const floor = maxR * 0.2
  let acc = 0
  let n = 0
  for (const r of rms) {
    if (r >= floor) {
      acc += r * r
      n++
    }
  }
  return n > 0 ? Math.sqrt(acc / n) : 0
}

/**
 * 让 take 对齐 ref 响度所需的增益，夹在 [min, max]。
 * 任一侧测不出（0）就不动增益。默认最多放大 10 倍、最多衰减到 0.5。
 */
export function matchGain(refLevel: number, takeLevel: number, min = 0.5, max = 10): number {
  if (!(refLevel > 0) || !(takeLevel > 0)) return 1
  return Math.min(max, Math.max(min, refLevel / takeLevel))
}

/** 整体乘增益并夹到 [-1,1]，避免削波 */
export function applyGain(samples: Float32Array, gain: number): Float32Array {
  const out = new Float32Array(samples.length)
  for (let i = 0; i < samples.length; i++) {
    const v = samples[i] * gain
    out[i] = v > 1 ? 1 : v < -1 ? -1 : v
  }
  return out
}

/** 峰值（多声道取最大绝对值的那个） */
export function peakOf(channels: Float32Array[]): number {
  let peak = 0
  for (const ch of channels) {
    for (let i = 0; i < ch.length; i++) {
      const a = Math.abs(ch[i])
      if (a > peak) peak = a
    }
  }
  return peak
}

/** 在「不削波」的前提下最多能用多大增益：wanted 与 0.99/峰值 取小 */
export function peakSafeGain(channels: Float32Array[], wanted: number): number {
  const peak = peakOf(channels)
  if (peak <= 0) return wanted
  return Math.min(wanted, 0.99 / peak)
}
