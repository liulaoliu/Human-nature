import { blankWord, normalizeAnswer, shuffleQuiz } from './quiz'
import { lemmaOf } from './vocab'
import { wordSpans } from './wordSelect'
import type { Sentence } from '../types/document'

/**
 * 逐句速读：纯逻辑。给一句算「目标阅读时长」（含少量思考余量），超时算「不太理解」，
 * 并挑一道**四选一**的「拷打」题（挖语言点搭配里的实词 / 生词 / 最长实词）。
 */

export const DEFAULT_WPM = 120
/** 每句额外给的思考余量（毫秒），避免短句太紧。 */
const GRACE_MS = 1500

const STOP = new Set([
  'the', 'and', 'that', 'with', 'this', 'from', 'have', 'were', 'which', 'their',
  'about', 'would', 'there', 'these', 'those', 'been', 'into', 'than', 'them',
  'then', 'when', 'what', 'your', 'more', 'some', 'such', 'only', 'also', 'over',
  'because', 'could', 'should', 'other', 'many', 'most', 'much', 'very', 'they',
  'will', 'while', 'where', 'after', 'before', 'between', 'still', 'just',
])

/** 兜底干扰词（不够用时补） */
const FALLBACK = [
  'increase', 'reduce', 'demand', 'supply', 'capital', 'emission', 'investment',
  'project', 'capacity', 'policy', 'market', 'energy', 'climate', 'support',
  'target', 'growth', 'source', 'network', 'reform', 'device',
]

export function wordCount(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length
}

/** 目标阅读时长（毫秒）：词数 / WPM + 思考余量，并给上下限。 */
export function targetMs(text: string, wpm = DEFAULT_WPM): number {
  const words = wordCount(text)
  const ms = (words / Math.max(50, wpm)) * 60000 + GRACE_MS
  return Math.max(2000, Math.min(30000, Math.round(ms)))
}

/** 句子里的实词（≥4 字母、非停用词）。 */
export function contentWords(text: string): string[] {
  return wordSpans(text)
    .map((w) => w.text.replace(/[^A-Za-z'-]/g, ''))
    .filter((w) => w.length >= 4 && !STOP.has(w.toLowerCase()))
}

export interface SpeedReadDrill {
  /** 挖空后的句子（拷打时原文隐藏，只给这句） */
  prompt: string
  /** 标准答案（原文里的词形） */
  answer: string
  accept: string[]
  via: 'phrase' | 'vocab' | 'word'
  /** 四选一选项（含正确答案，已打乱） */
  options: string[]
}

const canon = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '')

/** 在句子里找目标并挖空。优先语言点搭配里的实词，其次生词，最后最长实词。 */
function pickTargetBlank(
  sentence: Sentence,
): { blanked: string; surface: string; via: SpeedReadDrill['via'] } | null {
  const text = sentence.text.trim()
  if (!text) return null
  if (sentence.language?.phrases?.length) {
    for (const p of sentence.language.phrases) {
      const toks = p
        .split(/\s+/)
        .map((t) => t.replace(/[^A-Za-z'-]/g, ''))
        .filter((t) => t.length >= 4 && !STOP.has(t.toLowerCase()))
        .sort((a, b) => b.length - a.length)
      for (const tok of toks) {
        const b = blankWord(text, lemmaOf(tok))
        if (b) return { blanked: b.blanked, surface: b.surface, via: 'phrase' }
      }
    }
  }
  for (const v of sentence.vocab ?? []) {
    const b = blankWord(text, v.trim())
    if (b) return { blanked: b.blanked, surface: b.surface, via: 'vocab' }
  }
  for (const w of contentWords(text).sort((a, b) => b.length - a.length)) {
    const b = blankWord(text, lemmaOf(w))
    if (b) return { blanked: b.blanked, surface: b.surface, via: 'word' }
  }
  return null
}

/**
 * 挑一道四选一拷打题。`pool` 建议传整篇实词（干扰项更像样）。
 * 不够 3 个干扰项时返回 null（该句就不拷打）。
 */
export function pickDrill(sentence: Sentence, pool: string[] = [], rnd: () => number = Math.random): SpeedReadDrill | null {
  const chosen = pickTargetBlank(sentence)
  if (!chosen) return null
  const answer = chosen.surface
  const seen = new Set<string>([normalizeAnswer(answer)])
  const cands: string[] = []
  for (const c of [...pool, ...contentWords(sentence.text), ...FALLBACK]) {
    const w = c.trim()
    const k = normalizeAnswer(w)
    if (!w || seen.has(k)) continue
    seen.add(k)
    cands.push(w)
  }
  // 优先长度接近的，再打乱取 3 个
  cands.sort((a, b) => Math.abs(a.length - answer.length) - Math.abs(b.length - answer.length))
  const distractors = shuffleQuiz(cands.slice(0, 15), rnd).slice(0, 3)
  if (distractors.length < 3) return null
  const accept = [...new Set([normalizeAnswer(answer), lemmaOf(answer)])].filter(Boolean)
  return {
    prompt: chosen.blanked,
    answer,
    accept,
    via: chosen.via,
    options: shuffleQuiz([answer, ...distractors], rnd),
  }
}

/** 判分：归一化命中或忽略连字符/撇号/空格后一致。 */
export function checkDrill(drill: SpeedReadDrill, input: string): boolean {
  const n = normalizeAnswer(input)
  if (!n) return false
  if (drill.accept.includes(n)) return true
  const c = canon(n)
  return !!c && drill.accept.some((a) => canon(a) === c)
}

export interface SpeedRow {
  words: number
  ms: number
  slow: boolean
  drillOk: boolean | null
}

export interface SpeedSummary {
  count: number
  avgWpm: number
  slow: number
  drillTotal: number
  drillCorrect: number
}

export function summarize(rows: SpeedRow[]): SpeedSummary {
  let words = 0
  let ms = 0
  let slow = 0
  let drillTotal = 0
  let drillCorrect = 0
  for (const r of rows) {
    words += r.words
    ms += r.ms
    if (r.slow) slow += 1
    if (r.drillOk != null) {
      drillTotal += 1
      if (r.drillOk) drillCorrect += 1
    }
  }
  return {
    count: rows.length,
    avgWpm: ms > 0 ? Math.round((words / ms) * 60000) : 0,
    slow,
    drillTotal,
    drillCorrect,
  }
}
