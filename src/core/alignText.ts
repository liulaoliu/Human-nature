import type { Chunk } from './ports'

export interface AlignedChunk {
  index: number
  text: string
  /** 在全文里的起止词序号 [start, end) */
  wordRange: [number, number]
}

/** 句末标点，后面可以跟收尾的括号引号 */
const SENTENCE_END = /[.!?][)\]}"”’']*$/

/**
 * 把一段文本按块的时长比例摊到各块上。
 *
 * 严格说这不是对齐，是按比例猜。Economist 音频的朗读语速大致恒定，
 * 所以「块时长 / 总时长 × 总词数」得到的词数区间通常落在真实范围附近，
 * 但块内会有几个词的漂移。当作「这块大概读到哪」的导航用，不是精确字幕。
 *
 * offsetWords 是整体平移：音频不念副题/小标题时，文本会整体比音频「多」一截，
 * 高亮就跟不上听到的。正数表示把词窗往后推（高亮往前赶），负数反之。
 * 平移是加在边界上再夹到 [0, total] 的，首尾锚在 0 和 total，
 * 被挤出去的词归给第一块/最后一块 —— 所以下面那条硬保证不受影响。
 *
 * 唯一的硬保证：所有块按顺序拼起来 == 原文的词序，一个词不丢不重。
 */
export function alignTextToChunks(
  text: string,
  chunks: Chunk[],
  offsetWords = 0,
): AlignedChunk[] {
  const words = text.trim().split(/\s+/).filter(Boolean)
  if (chunks.length === 0) return []

  const total = words.length
  const durations = chunks.map((c) => Math.max(0, c.end - c.start))
  const totalDur = durations.reduce((a, b) => a + b, 0)
  if (totalDur <= 0) {
    return chunks.map((c) => ({ index: c.index, text: '', wordRange: [0, 0] as [number, number] }))
  }

  // 每块按比例的结束词序号，强制单调
  const n = chunks.length
  const raw: number[] = []
  let acc = 0
  for (let i = 0; i < n; i++) {
    acc += durations[i]
    const at = i === n - 1 ? total : Math.round((acc / totalDur) * total)
    raw.push(i === 0 ? at : Math.max(at, raw[i - 1]))
  }

  // 整体平移。clamp 是单调的，所以平移后仍然单调；末块锚回 total，
  // 中间的平移量才不会被夹掉。
  const bounds = raw.map((v) => Math.min(Math.max(v + offsetWords, 0), total))
  bounds[n - 1] = total

  const parenDepth = depthAfterEachWord(words)
  const ends: number[] = []
  let start = 0
  for (let i = 0; i < n; i++) {
    const limit = i === n - 1 ? total : bounds[i + 1]
    let end = i === n - 1 ? total : snapToSentence(words, parenDepth, bounds[i], limit, start)
    end = Math.min(end, Math.max(limit, start))
    if (end <= start && start < total) end = start + 1 // 不给空块，除非词已用完
    ends.push(end)
    start = end
  }

  return chunks.map((c, i) => {
    const s = i === 0 ? 0 : ends[i - 1]
    return { index: c.index, text: words.slice(s, ends[i]).join(' '), wordRange: [s, ends[i]] }
  })
}

/** 每个词读完之后，括号还剩几层没闭合 */
function depthAfterEachWord(words: string[]): number[] {
  const out: number[] = []
  let depth = 0
  for (const w of words) {
    const open = (w.match(/[([{]/g) ?? []).length
    const close = (w.match(/[)\]}]/g) ?? []).length
    depth = Math.max(0, depth + open - close)
    out.push(depth)
  }
  return out
}

/**
 * 从 at 往两边找最近的句末。三个约束：
 * 1. 下一句首字母要大写，否则 "The U.S. economy" 会被切成两半
 * 2. 那个句号不能在未闭合的括号里，否则 "(see page 4. Note this)." 会切错
 * 3. 搜索窗口按块自身大小算（±60%），不越到下一块的地界去
 *    —— 固定窗口会把 6 词的小块撑成 16 词，比例就废了
 * 找不到就退回 at。
 */
function snapToSentence(
  words: string[],
  parenDepth: number[],
  at: number,
  limit: number,
  floor: number,
): number {
  const half = Math.max(2, Math.round(at * 0.6))
  const from = Math.max(floor, at - half)
  const to = Math.min(limit, at + half)
  for (let i = from; i < to; i++) {
    if (parenDepth[i] !== 0) continue
    if (!SENTENCE_END.test(words[i])) continue
    const next = words[i + 1]
    if (next === undefined) return i + 1
    if (/^[“‘"']?[A-Z]/.test(next)) return i + 1
  }
  return Math.min(Math.max(at, floor), limit)
}
