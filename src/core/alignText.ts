import type { Chunk, ManualAnchor } from './ports'

export interface AlignedChunk {
  index: number
  text: string
  /** 在全文里的起止词序号 [start, end) */
  wordRange: [number, number]
  /** 这一块是被手动锚点钉过的（UI 上标出来） */
  anchored?: boolean
}

/** 锚点映射到具体块号、并重新定位词序号之后的样子 */
export interface ResolvedAnchor {
  atSec: number
  chunkIndex: number
  startWord: number
  endWord: number
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

/**
 * 把锚点解析成「哪一块、对应原文哪几个词」。
 *
 * 两步：
 * 1. atSec → 块号（按音频时间，所以换切块粒度不失效）
 * 2. 找词范围：优先在**当前词表**里搜锚点记下的那段原文
 *    （`text`），搜得到就用它的位置 —— 这样改别处的文字后进度不乱；
 *    搜不到（那段本身被改了）再退回记下的词序号并夹紧。
 *
 * 同一块只留一个锚点；重叠/乱序的靠前的赢。返回的 `chunkIndex` 递增、
 * 词范围不重叠，喂给对齐逻辑就能保证「拼起来等于原文」。
 */
export function resolveAnchors(
  words: string[],
  chunks: Chunk[],
  anchors: ManualAnchor[],
): ResolvedAnchor[] {
  const byChunk = new Map<number, ResolvedAnchor>()
  for (const a of anchors) {
    const located = locateAnchor(a, words)
    if (!located) continue
    const k = chunkIndexAt(chunks, a.atSec)
    byChunk.set(k, { atSec: a.atSec, chunkIndex: k, startWord: located[0], endWord: located[1] })
  }
  const out: ResolvedAnchor[] = []
  for (const a of [...byChunk.values()].sort((x, y) => x.chunkIndex - y.chunkIndex)) {
    const prev = out[out.length - 1]
    if (prev && a.startWord < prev.endWord) continue
    out.push(a)
  }
  return out
}

/** 在词表里找回锚点记的那段原文；搜不到就退回存下的序号 */
function locateAnchor(a: ManualAnchor, words: string[]): [number, number] | null {
  const total = words.length
  const stored = clampInt(a.startWord, 0, total)
  const seq = a.text ? a.text.trim().split(/\s+/).filter(Boolean) : []
  if (seq.length > 0) {
    const at = findWordSequence(words, seq, stored)
    if (at >= 0) return [at, at + seq.length]
  }
  const end = clampInt(a.endWord, 0, total)
  return end > stored ? [stored, end] : null
}

/** 在 words 里找 seq 出现的位置，取离 hint 最近的那个（防止重复短语认错） */
function findWordSequence(words: string[], seq: string[], hint: number): number {
  let best = -1
  let bestDist = Infinity
  const last = words.length - seq.length
  for (let i = 0; i <= last; i++) {
    let ok = true
    for (let j = 0; j < seq.length; j++) {
      if (words[i + j] !== seq[j]) {
        ok = false
        break
      }
    }
    if (!ok) continue
    const d = Math.abs(i - hint)
    if (d < bestDist) {
      bestDist = d
      best = i
    }
  }
  return best
}

/**
 * 带手动锚点的对齐。
 *
 * 每个锚点说「音频里 atSec 那一块，读的是原文的某一段」。
 * 锚点之间（以及首尾）的词按块时长比例摊开 —— 手工钉住的几块是准的，
 * 没钉的地方仍旧是估的，但**全文一个词不丢不重**。
 *
 * 首尾 b[0]/b[N] 一定锚死，所以即使给第 1 块锚一个 startWord>0 也不会丢开头的词。
 */
export function alignTextToChunksWithAnchors(
  text: string,
  chunks: Chunk[],
  anchors: ManualAnchor[],
): AlignedChunk[] {
  const n = chunks.length
  if (n === 0) return []
  const words = text.trim().split(/\s+/).filter(Boolean)
  const total = words.length
  if (total === 0 || anchors.length === 0) return alignTextToChunks(text, chunks, 0)

  const clean = resolveAnchors(words, chunks, anchors)
  if (clean.length === 0) return alignTextToChunks(text, chunks, 0)

  // 已知的块边界（词序号）。锚点把两个相邻边界钉死；
  // b[0]=0、b[n]=total 一定要最后设：首尾是硬的，锚点碰不到它们
  // （不然给第 1 块锚一个 startWord>0 会让开头的词没处去，末尾同理）。
  const fixed = new Map<number, number>()
  for (const a of clean) {
    fixed.set(a.chunkIndex, a.startWord)
    fixed.set(a.chunkIndex + 1, a.endWord)
  }
  fixed.set(0, 0)
  fixed.set(n, total)
  const points = [...fixed.entries()].sort((x, y) => x[0] - y[0])

  const anchored = new Set(clean.map((a) => a.chunkIndex))
  const result: AlignedChunk[] = new Array(n)
  for (let p = 0; p < points.length - 1; p++) {
    const [i, u] = points[p]
    const [j, v] = points[p + 1]
    const subText = words.slice(u, v).join(' ')
    const sub = alignTextToChunks(subText, chunks.slice(i, j), 0)
    for (const a of sub) {
      result[a.index] = {
        index: a.index,
        text: a.text,
        wordRange: [u + a.wordRange[0], u + a.wordRange[1]],
      }
    }
  }

  return chunks.map((c, i) => {
    const cell = result[i] ?? { index: c.index, text: '', wordRange: [0, 0] as [number, number] }
    return anchored.has(i) ? { ...cell, anchored: true } : cell
  })
}

/** t 落在哪一块（按 start <= t < end）；落在缝里/外面就取最近的那块 */
function chunkIndexAt(chunks: Chunk[], t: number): number {
  let best = 0
  let bestDist = Infinity
  for (let i = 0; i < chunks.length; i++) {
    if (t < chunks[i].end) return i
    const d = Math.abs(chunks[i].start - t)
    if (d < bestDist) {
      bestDist = d
      best = i
    }
  }
  return best
}

function clampInt(v: number, lo: number, hi: number): number {
  if (!Number.isFinite(v)) return lo
  return Math.min(Math.max(Math.round(v), lo), hi)
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
