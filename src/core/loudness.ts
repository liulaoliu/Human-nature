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

/** 一段音频里「真正在说话」的起止（秒，相对录音起点） */
export interface SpeechBounds {
  from: number
  to: number
}

/**
 * 找出首尾静音之外那段「真在说话」的范围，用来让录音回放不空等。
 *
 * 跟读录音两头一定有空档：按下录音到开口、读完到松手。A/B 对比时
 * 把这些静音一起放出来，听感上就是「怎么还没声 / 怎么还不结束」。
 *
 * 判法跟 `speechRms` 同源：20ms 一帧算 RMS，阈值取「最大帧的 10%」和
 * 绝对下限 0.006 里大的那个（避开底噪），取第一帧和最后一帧过阈值的；
 * 两侧各留 `padSec` 余量，别把字头的气口、字尾的尾音切掉。
 *
 * 返回整段（from=0, to=时长）表示「没把握，别裁」：全静音、太短、
 * 或者裁完只剩不到 0.15 秒，都按没裁处理。
 */
export function speechBounds(
  samples: Float32Array,
  sampleRate: number,
  frameMs = 20,
  padSec = 0.12,
): SpeechBounds {
  const duration = sampleRate > 0 ? samples.length / sampleRate : 0
  const whole: SpeechBounds = { from: 0, to: duration }
  if (samples.length === 0 || sampleRate <= 0) return whole

  const frameLen = Math.max(1, Math.round((sampleRate * frameMs) / 1000))
  if (samples.length < frameLen * 2) return whole

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
  // 整段几乎没声音：不裁（裁了会让回放变成空响）
  if (maxR < 0.004) return whole

  const threshold = Math.max(maxR * 0.1, 0.006)
  let first = -1
  let last = -1
  for (let i = 0; i < rms.length; i++) {
    if (rms[i] >= threshold) {
      if (first < 0) first = i
      last = i
    }
  }
  if (first < 0) return whole

  const frameSec = frameLen / sampleRate
  const from = Math.max(0, first * frameSec - padSec)
  const to = Math.min(duration, (last + 1) * frameSec + padSec)
  // 剩下太短说明阈值判错了（比如只有一声咳嗽），保持原样
  if (to - from < 0.15) return whole
  return { from, to }
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
