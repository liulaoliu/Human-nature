/**
 * 能量法 VAD。原理就是一条水平线：
 * 1. 每 10ms 算一次 RMS，转成 dB
 * 2. 出一条阈值线（默认由数据自动算）
 * 3. 线以上算"有人在说话"，连续的一段就是一个 Span
 *
 * 没有 AI，没有模型。1990 年代的技术，40 行。
 */

export interface Span {
  start: number // 秒
  end: number // 秒
}

export interface VadOptions {
  frameMs?: number // 帧长，默认 10
  hopMs?: number // 帧移，默认 5
  thresholdDb?: number // 显式阈值；不给则自动算
  minSpeechMs?: number // 短于此长度的段丢弃，默认 200
  mergeGapMs?: number // 短于此长度的间隔合并，默认 400
}

const EPS = 1e-10

/** 逐帧 RMS → dB */
export function frameDb(
  samples: Float32Array,
  sampleRate: number,
  frameMs: number,
  hopMs: number,
): Float32Array {
  const frameLen = Math.max(1, Math.round((sampleRate * frameMs) / 1000))
  const hopLen = Math.max(1, Math.round((sampleRate * hopMs) / 1000))
  const count =
    samples.length < frameLen ? 0 : Math.floor((samples.length - frameLen) / hopLen) + 1

  const out = new Float32Array(count)
  for (let f = 0; f < count; f++) {
    const off = f * hopLen
    let acc = 0
    for (let i = 0; i < frameLen; i++) {
      const v = samples[off + i]
      acc += v * v
    }
    out[f] = 20 * Math.log10(Math.sqrt(acc / frameLen) + EPS)
  }
  return out
}

/**
 * 自动阈值，两项取大的那个：
 *   1. 噪声底 + 6dB —— 防止阈值太低，停顿永远切不出来
 *   2. 中位数 - 18dB —— 防止噪声底太高（背景音乐），把轻声也切掉
 *
 * 噪声底用 p10 而不是 p20：连续朗读的音频里静音可能不足 20%，
 * p20 会落进语音区把句尾的轻音节切没（测试里踩过）。
 * 实测 Economist 音频：p10≈-72dB，p50=-24.8dB → 线画在 -35dB 附近。
 */
export function autoThresholdDb(
  samples: Float32Array,
  sampleRate: number,
  opts: Pick<VadOptions, 'frameMs' | 'hopMs'> = {},
): number {
  const db = frameDb(samples, sampleRate, opts.frameMs ?? 10, opts.hopMs ?? 5)
  if (db.length === 0) return -60

  const sorted = Float32Array.from(db).sort()
  const at = (p: number) => sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))]

  return Math.max(at(0.1) + 6, at(0.5) - 18)
}

export function detectSpeechSpans(
  samples: Float32Array,
  sampleRate: number,
  opts: VadOptions = {},
): Span[] {
  const frameMs = opts.frameMs ?? 10
  const hopMs = opts.hopMs ?? 5
  const minSpeechMs = opts.minSpeechMs ?? 200
  const mergeGapMs = opts.mergeGapMs ?? 400
  const hopSec = hopMs / 1000

  const db = frameDb(samples, sampleRate, frameMs, hopMs)
  if (db.length === 0) return []

  const thr = opts.thresholdDb ?? autoThresholdDb(samples, sampleRate, { frameMs, hopMs })

  // 过线即有声音
  const raw: Span[] = []
  let speaking = false
  let startFrame = 0
  for (let f = 0; f < db.length; f++) {
    const loud = db[f] > thr
    if (loud && !speaking) {
      speaking = true
      startFrame = f
    } else if (!loud && speaking) {
      speaking = false
      raw.push({ start: startFrame * hopSec, end: f * hopSec })
    }
  }
  if (speaking) raw.push({ start: startFrame * hopSec, end: db.length * hopSec })

  // 合并过近的段
  const merged: Span[] = []
  for (const sp of raw) {
    const last = merged[merged.length - 1]
    if (last && (sp.start - last.end) * 1000 <= mergeGapMs) last.end = sp.end
    else merged.push({ ...sp })
  }

  return merged.filter((s) => (s.end - s.start) * 1000 >= minSpeechMs)
}
