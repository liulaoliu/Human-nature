import type { Paragraph, Sentence } from '../types/document'
import { defaultReviewState } from '../types/document'

/**
 * 切分模块：把清洗后的规范文本，切成 Paragraph + Sentence。
 *
 * 优先用浏览器原生的 `Intl.Segmenter`（语言感知、零依赖），
 * 再用缩写白名单修补；没有 `Intl.Segmenter` 的环境退回正则。
 *
 * id 稳定：段落 `p01` 递增，句子 `s001` 递增，顺序与原文一致。
 */

export interface SegmentResult {
  paragraphs: Paragraph[]
  sentences: Sentence[]
}

/** 常见缩写。句尾若是这些词加句点，说明没到句末，要和下句合并。 */
const ABBREVIATIONS = new Set([
  'mr', 'mrs', 'ms', 'dr', 'prof', 'st', 'vs', 'etc', 'no', 'fig', 'al',
  'e.g', 'i.e', 'u.s', 'u.k', 'u.n', 'inc', 'ltd', 'co', 'jr', 'sr',
  'gen', 'sen', 'rep', 'gov', 'approx', 'dept', 'est',
])

/** 句尾是否是「缩写 + 句点」。 */
function endsWithAbbreviation(s: string): boolean {
  const m = s.trimEnd().match(/([A-Za-z](?:[A-Za-z.]*[A-Za-z])?)\.$/)
  if (!m) return false
  return ABBREVIATIONS.has(m[1].toLowerCase())
}

/** 用 Intl.Segmenter 切句；不可用时退回正则。 */
function rawSegments(paragraph: string): string[] {
  const Segmenter = (Intl as unknown as { Segmenter?: unknown }).Segmenter
  if (typeof Segmenter === 'function') {
    const seg = new (Segmenter as new (
      locale: string,
      opts: { granularity: string },
    ) => { segment(input: string): Iterable<{ segment: string }> })('en', {
      granularity: 'sentence',
    })
    return Array.from(seg.segment(paragraph), (s) => s.segment.trim()).filter(Boolean)
  }
  return paragraph.split(/(?<=[.?!]["”')\]]?)\s+/).filter(Boolean)
}

/** 把一段切成一串句子，并把缩写造成的误切合回去。 */
export function splitSentences(paragraph: string): string[] {
  const out: string[] = []
  for (const seg of rawSegments(paragraph)) {
    const prev = out[out.length - 1]
    if (prev !== undefined && endsWithAbbreviation(prev)) {
      out[out.length - 1] = `${prev} ${seg}`
    } else {
      out.push(seg)
    }
  }
  return out
}

/** 切分主入口。输入是 `cleanText` 的输出。 */
export function segment(cleaned: string): SegmentResult {
  const paragraphs: Paragraph[] = []
  const sentences: Sentence[] = []
  let p = 0
  let s = 0

  for (const para of cleaned.split(/\n{2,}/)) {
    const text = para.trim()
    if (!text) continue
    p += 1
    const paraId = `p${String(p).padStart(2, '0')}`
    const sentenceIds: string[] = []
    for (const sentenceText of splitSentences(text)) {
      s += 1
      const id = `s${String(s).padStart(3, '0')}`
      sentenceIds.push(id)
      sentences.push({
        id,
        paraId,
        text: sentenceText,
        audio: null,
        translation: null,
        grammarNote: null,
        collocations: [],
        vocab: [],
        tags: [],
        reviewState: defaultReviewState(),
      })
    }
    paragraphs.push({ id: paraId, sentenceIds })
  }

  return { paragraphs, sentences }
}

/**
 * 重新切句后，把旧句子上挂着的分析结果按「句文相同」搬过来。
 *
 * 编辑正文要重新切句（`segment` 会新建一批 Sentence 对象），不搬的话
 * 之前粘回来的翻译 / 语法 / 搭配 / 生词 / 时间轴会全部丢掉。
 * 同一句文出现多次时，按出现顺序一一对应。
 */
export function carryAnalysis(previous: Sentence[], next: Sentence[]): Sentence[] {
  const buckets = new Map<string, Sentence[]>()
  for (const p of previous) {
    const key = p.text.trim()
    const arr = buckets.get(key)
    if (arr) arr.push(p)
    else buckets.set(key, [p])
  }
  return next.map((s) => {
    const src = buckets.get(s.text.trim())?.shift()
    if (!src) return s
    return {
      ...s,
      translation: src.translation,
      grammarNote: src.grammarNote,
      collocations: src.collocations,
      vocab: src.vocab,
      audio: src.audio,
      tags: src.tags,
    }
  })
}
