/**
 * 听写对比：把你打的句子和标准句子逐词比对，标出**漏写**和**多写**。
 *
 * 纯函数，不碰 DOM，方便单测。用 LCS（最长公共子序列）做词级 diff：
 *   - same：两边的词一致（比大小写、标点宽松）
 *   - del ：标准句里有、你没写（漏写 / 拼错后少了正确词）
 *   - ins ：你没对、多写的词
 *
 * 目标不是完美对齐，而是让「哪里错了」一眼可见。
 */

import { wordSpans } from './wordSelect'
import { lemmaOf } from './vocab'
import { normalizeAnswer, shuffleQuiz } from './quiz'

export type DiffType = 'same' | 'del' | 'ins'

export interface DiffToken {
  type: DiffType
  text: string
}

/** 按空白切词（保留词形，含标点）。 */
export function wordTokens(s: string): string[] {
  return s
    .split(/\s+/)
    .map((t) => t.trim())
    .filter(Boolean)
}

/** 比较用的归一化：小写、去标点（撇号保留）。 */
function norm(w: string): string {
  return w
    .toLowerCase()
    .normalize('NFKC')
    .replace(/[^a-z0-9']/g, '')
}

export interface DiffResult {
  tokens: DiffToken[]
  /** 逐词完全一致 */
  correct: boolean
  /** 漏写（标准句里的词） */
  missed: string[]
  /** 多写（你写多的词） */
  extra: string[]
}

/** 词级 diff。ref = 标准句，got = 你写的。 */
export function diffWords(ref: string, got: string): DiffResult {
  const a = wordTokens(ref)
  const b = wordTokens(got)
  const na = a.map(norm)
  const nb = b.map(norm)
  const n = a.length
  const m = b.length

  // LCS 长度
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0))
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = na[i] === nb[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1])
    }
  }

  const tokens: DiffToken[] = []
  const missed: string[] = []
  const extra: string[] = []
  let i = 0
  let j = 0
  while (i < n && j < m) {
    if (na[i] === nb[j]) {
      tokens.push({ type: 'same', text: a[i] })
      i++
      j++
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      tokens.push({ type: 'del', text: a[i] })
      missed.push(a[i])
      i++
    } else {
      tokens.push({ type: 'ins', text: b[j] })
      extra.push(b[j])
      j++
    }
  }
  while (i < n) {
    tokens.push({ type: 'del', text: a[i] })
    missed.push(a[i])
    i++
  }
  while (j < m) {
    tokens.push({ type: 'ins', text: b[j] })
    extra.push(b[j])
    j++
  }

  const correct = missed.length === 0 && extra.length === 0
  return { tokens, correct, missed, extra }
}

/** 听写错词：漏写的标准词，去重（供加入待选 / 错词本）。 */
export function dictationWrongWords(result: DiffResult): string[] {
  const out: string[] = []
  for (const w of result.missed) {
    const key = norm(w)
    if (key && !out.some((x) => norm(x) === key)) out.push(w)
  }
  return out
}

/**
 * 把长句按标点（, ; : — –）切成更适合听写的短块；单块仍超过 maxWords 就按词硬切。
 * 用于「一句话好几十秒」听不下来的情况。
 */
export function splitForDictation(text: string, maxWords = 12): string[] {
  const t = text.trim()
  if (!t) return []
  const out: string[] = []
  for (const part of t.split(/(?<=[,;:—–])/)) {
    const p = part.trim()
    if (!p) continue
    const words = p.split(/\s+/)
    if (words.length <= maxWords) {
      out.push(p)
    } else {
      for (let i = 0; i < words.length; i += maxWords) out.push(words.slice(i, i + maxWords).join(' '))
    }
  }
  return out
}

export interface ClozeBlank {
  /** 标准词形（原文里的样子） */
  answer: string
  /** 可接受答案 */
  accept: string[]
}

export interface ClozeQuestion {
  sentence: string
  /** 挖空后的展示文本（空用 ____） */
  display: string
  blanks: ClozeBlank[]
}

/** 常见虚词，不拿来挖空。 */
const STOPWORDS = new Set([
  'the','a','an','and','or','but','of','to','in','on','at','for','with','is','are','was','were',
  'be','been','being','it','its','this','that','these','those','as','by','from','not','no','they',
  'we','you','he','she','i','his','her','their','our','your','my','me','him','them','us','so','if',
  'than','then','when','while','into','over','under','also','more','most','much','many','very',
  'can','could','will','would','should','may','might','must','do','does','did','has','have','had',
  'there','here','what','which','who','whom','how','why','all','any','some','such','only','just',
])

/**
 * 从句子里挑 n 个值得练的词来做填空：**优先词库里的词**，否则挑较长的实词。
 * 返回它们在原文里的词形（按出现顺序）。
 */
export function pickBlankTargets(
  text: string,
  pool: Set<string>,
  n = 2,
  rnd: () => number = Math.random,
): string[] {
  const spans = wordSpans(text)
  const lib: string[] = []
  const cands: string[] = []
  for (const w of spans) {
    const bare = w.text.replace(/[^A-Za-z'-]/g, '')
    if (bare.length < 3) continue
    const low = bare.toLowerCase()
    if (pool.has(low) || pool.has(lemmaOf(bare))) lib.push(w.text)
    else if (bare.length >= 5 && !STOPWORDS.has(low)) cands.push(w.text)
  }
  const source = lib.length ? lib : cands
  if (!source.length) return []
  const chosen: string[] = []
  const shuffled = shuffleQuiz(source, rnd)
  for (const w of shuffled) {
    if (!chosen.some((x) => x.toLowerCase() === w.toLowerCase())) chosen.push(w)
    if (chosen.length >= n) break
  }
  // 按在原句中的先后排序，方便对应
  const order = new Map(spans.map((w, i) => [w.text.toLowerCase(), i]))
  chosen.sort((a, b) => (order.get(a.toLowerCase()) ?? 0) - (order.get(b.toLowerCase()) ?? 0))
  return chosen
}

/** 把 targets 在原句里挖成 ____，返回展示文本与答案。 */
export function makeCloze(text: string, targets: string[]): ClozeQuestion {
  const wanted = new Set(targets.map((t) => t.trim().toLowerCase()).filter(Boolean))
  const spans = wordSpans(text)
  const blanks: ClozeBlank[] = []
  let display = ''
  let pos = 0
  for (const w of spans) {
    if (w.start > pos) display += text.slice(pos, w.start)
    if (wanted.has(w.text.toLowerCase())) {
      display += '____'
      const set = new Set<string>([normalizeAnswer(w.text), w.text.toLowerCase(), lemmaOf(w.text)])
      blanks.push({ answer: w.text, accept: [...set].filter(Boolean) })
    } else {
      display += w.text
    }
    pos = w.end
  }
  if (pos < text.length) display += text.slice(pos)
  return { sentence: text, display, blanks }
}

/** 判一个空对不对（忽略大小写 / 首尾标点，词形还原一致也算对）。 */
export function isClozeBlankCorrect(blank: ClozeBlank, input: string): boolean {
  const n = normalizeAnswer(input)
  if (!n) return false
  if (blank.accept.includes(n)) return true
  return lemmaOf(n) === lemmaOf(blank.answer)
}

