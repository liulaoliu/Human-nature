import type { Chunk } from './ports'
import type { AudioSegment, Sentence } from '../types/document'
import { alignTextToChunks } from './alignText'

/**
 * 句子级音频对齐（近似投影）。
 *
 * 复用 `alignText.ts` 的「块级比例摊词 + 手动锚点」，把块时间投影到句子上：
 * 句子落在某块内就按词在块内的比例分配时间；跨块就取首词到末词的时间。
 *
 * 这不是强制对齐——本项目的定位是导航，不是字幕。低置信度/算不出来的句子
 * `audio` 保持 `null`，播放器降级为纯文本。
 */

function round2(t: number): number {
  return Math.round(t * 100) / 100
}

/** 给每个句子写回近似的 audio 区间。返回新数组，不改原对象。 */
export function alignSentences(
  sentences: Sentence[],
  chunks: Chunk[],
  offsetWords = 0,
): Sentence[] {
  if (!sentences.length || !chunks.length) {
    return sentences.map((s) => (s.audio === null ? s : { ...s, audio: null }))
  }

  const text = sentences.map((s) => s.text).join(' ')
  const aligned = alignTextToChunks(text, chunks, offsetWords)

  // 句子 → 词序号区间
  const ranges: [number, number][] = []
  let acc = 0
  for (const s of sentences) {
    const n = s.text.trim() ? s.text.trim().split(/\s+/).length : 0
    ranges.push([acc, acc + n])
    acc += n
  }
  const total = acc

  // 每个词序号 → 时间（块内线性插值）
  const wordTime = new Float64Array(total + 1).fill(NaN)
  aligned.forEach((c, ci) => {
    const ch = chunks[ci]
    if (!ch) return
    const [a, b] = c.wordRange
    const dur = Math.max(0, ch.end - ch.start)
    for (let i = a; i < b; i++) {
      wordTime[i] = ch.start + ((i - a) / Math.max(1, b - a)) * dur
    }
    wordTime[b] = ch.end
  })
  if (Number.isNaN(wordTime[0])) wordTime[0] = chunks[0].start

  return sentences.map((s, si) => {
    const [startWord, endWord] = ranges[si]
    if (endWord <= startWord) return { ...s, audio: null as AudioSegment | null }
    const st = wordTime[startWord]
    const en = wordTime[endWord]
    const audio =
      Number.isFinite(st) && Number.isFinite(en) && en >= st
        ? { start: round2(st), end: round2(en) }
        : null
    return { ...s, audio }
  })
}
