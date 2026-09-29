import type { Chunk } from './ports'

/**
 * 手动「撕开 / 合并」音频块。
 *
 * VAD 切出来的块只认音量，碰到连续朗读（句间停不到合并阈值）就会切出一大块。
 * 这里不重跑切块，而是在 VAD 结果上再叠加一层**手动**边界：
 * - `splits`：每个时间点 t，把包含它的那一块切成 [start, t] 和 [t, end]
 * - `merges`：每个时间点 t，把「起点是 t」的那一块并进上一块（等于删掉那条边界）
 *
 * 两个都按**秒**记（和手动锚点一样），所以换「切块」档位重新 VAD 之后，
 * 只要新块里还能找到对应时间，手动编辑就照样生效；找不到就忽略，不报错。
 *
 * 硬保证：拼起来仍然是原来那段音频，不重不漏（切出来的碎片都落在块内）。
 */

/** 撕/合时离块两端至少留这么久，免得切出 0.06 秒的碎片 */
export const MIN_PIECE_SEC = 0.06

/** 两个时间算不算同一个点（毫秒级容差） */
const SAME_SEC = 0.02

function sameTime(a: number, b: number): boolean {
  return Math.abs(a - b) < SAME_SEC
}

export function applyChunkEdits(
  chunks: Chunk[],
  splits: number[] = [],
  merges: number[] = [],
  minPieceSec = MIN_PIECE_SEC,
): Chunk[] {
  if (chunks.length === 0) return []

  const out = chunks.map((c) => ({ start: c.start, end: c.end }))

  // 撕开：按时间排序，逐个找包含它的块。同一刀只切一次（5ms 内算同一刀）。
  // 注意保留原始时间、不四舍五入：锚点也按同一时间记，两边差一点就会错位。
  const cuts = [...splits].sort((a, b) => a - b)
  let lastCut = Number.NEGATIVE_INFINITY
  for (const t of cuts) {
    if (Math.abs(t - lastCut) < 0.005) continue
    lastCut = t
    const i = out.findIndex((c) => t - c.start >= minPieceSec && c.end - t >= minPieceSec)
    if (i < 0) continue
    const c = out[i]
    out.splice(i, 1, { start: c.start, end: t }, { start: t, end: c.end })
  }

  // 合并：找到起点是 t 的那块，把它并进上一块。
  for (const t of merges) {
    const i = out.findIndex((c, k) => k > 0 && sameTime(c.start, t))
    if (i <= 0) continue
    out[i - 1] = { start: out[i - 1].start, end: out[i].end }
    out.splice(i, 1)
  }

  return out.map((c, index) => ({ index, start: c.start, end: c.end }))
}

/**
 * 在 [from, to] 里找最安静的一小段，返回它的中心时间（秒）。
 * 撕块时给个「切在气口上」的默认刀口，用户再在波形上精调。
 */
export function findQuietestSec(
  samples: Float32Array,
  sampleRate: number,
  from: number,
  to: number,
  frameMs = 10,
): number {
  if (samples.length === 0 || sampleRate <= 0 || to <= from) return (from + to) / 2

  const frameLen = Math.max(1, Math.round((sampleRate * frameMs) / 1000))
  const a = Math.max(0, Math.floor(from * sampleRate))
  const b = Math.min(samples.length, Math.ceil(to * sampleRate))
  const edge = Math.min(frameLen, Math.floor((b - a) / 4))
  const lo = a + edge
  const hi = Math.max(lo + 1, b - edge)

  let best = Math.floor((lo + hi) / 2)
  let bestRms = Infinity
  for (let start = lo; start + frameLen <= hi; start += frameLen) {
    let acc = 0
    for (let i = 0; i < frameLen; i++) {
      const v = samples[start + i]
      acc += v * v
    }
    const rms = acc / frameLen
    if (rms < bestRms) {
      bestRms = rms
      best = start + Math.floor(frameLen / 2)
    }
  }
  return best / sampleRate
}
