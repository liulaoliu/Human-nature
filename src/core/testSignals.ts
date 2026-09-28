/**
 * 合成测试信号。确定性伪随机，无外部依赖。
 * 复现了真实素材的特征：噪声底约 -52dB，语音约 -25dB。
 */

export type SegKind = 'speech' | 'silence'

/** 语音段用几个不同频率的正弦叠加，模拟有音节起伏的语调 */
function fillSpeech(out: Float32Array, from: number, to: number, sampleRate: number, seed: number) {
  const len = to - from
  for (let i = 0; i < len; i++) {
    const t = i / sampleRate
    const env = 0.6 + 0.4 * Math.sin(2 * Math.PI * 4.5 * t + seed) // 音节起伏
    const v =
      0.34 * Math.sin(2 * Math.PI * 180 * t) +
      0.3 * Math.sin(2 * Math.PI * 720 * t) +
      0.16 * Math.sin(2 * Math.PI * 2400 * t)
    out[from + i] = v * env
  }
}

function fillNoise(out: Float32Array, from: number, to: number, seed: number) {
  let s = seed
  for (let i = from; i < to; i++) {
    s = (s * 1664525 + 1013904223) >>> 0
    out[i] = ((s / 0xffffffff) * 2 - 1) * 0.004 // 约 -48dB 底噪
  }
}

export function buildSignal(
  segments: Array<[SegKind, number]>,
  sampleRate = 8000,
  seed = 12345,
): { samples: Float32Array; sampleRate: number } {
  const total = segments.reduce((a, [, sec]) => a + sec, 0)
  const n = Math.round(total * sampleRate)
  const samples = new Float32Array(n)

  let cursor = 0
  let localSeed = seed
  for (const [kind, sec] of segments) {
    const count = Math.round(sec * sampleRate)
    const from = cursor
    const to = Math.min(cursor + count, n)
    if (kind === 'speech') fillSpeech(samples, from, to, sampleRate, localSeed)
    else fillNoise(samples, from, to, localSeed)
    localSeed += 1
    cursor = to
  }
  // 语音段之间也铺一点底噪，贴近真实录音
  for (let i = 0; i < n; i++) {
    if (Math.abs(samples[i]) < 0.001) fillNoise(samples, i, i + 1, seed)
  }
  return { samples, sampleRate }
}
