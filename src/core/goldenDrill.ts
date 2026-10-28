import { compareToReference, diffWords, type Closeness, type DiffPart } from './backTranslate'
import { findGoldenTargetSpans } from './golden'
import { normalizeAnswer, shuffleQuiz } from './quiz'
import { canonical } from './quizParts'
import { wordSpans } from './wordSelect'
import type { GoldenTarget, GoldenTargetKind } from '../types/document'

/** 金句课的三种练习：挖空、拼句、逆向默写；只做判分/构造，不碰会话状态。 */

export interface GoldenClozeBlank {
  /** 空序号（1 起）；一个词一个空时，同一语言点的多个词各占一个 */
  index: number
  targetIndex: number
  /** 按词拆时，词在该语言点内的序号（0 起）；按整块时没有 */
  wordIndex?: number
  answer: string
  hint?: string
  kind: GoldenTargetKind
}

export interface GoldenClozePart {
  text: string
  blank: boolean
  targetIndex?: number
  blankIndex?: number
}

export interface GoldenCloze {
  sentence: string
  parts: GoldenClozePart[]
  blanks: GoldenClozeBlank[]
  targets: GoldenTarget[]
}

export interface GoldenClozeOptions {
  /** true = 一个词一个空；false（默认）= 一个语言点一个空 */
  splitWords?: boolean
}

/**
 * 把目标在句子里挖空。
 *
 * - 默认按语言点整块挖（拼句也用这份）；
 * - 填空传 `splitWords: true` 时，一个词一个空；
 * - 同一目标重复出现时共用同一组空，保持“一个输入管所有出现位置”的旧语义。
 */
export function buildGoldenCloze(text: string, targets: GoldenTarget[], opts: GoldenClozeOptions = {}): GoldenCloze | null {
  const found = targets
    .map((target, targetIndex) => ({ target, targetIndex, spans: findGoldenTargetSpans(text, target.en) }))
    .filter((x) => x.spans.length > 0)
  if (!found.length) return null
  const candidates = found
    .flatMap((x) => x.spans.map((sp) => ({ start: sp.start, end: sp.end, text: sp.text, targetIndex: x.targetIndex })))
    .sort((a, b) => a.start - b.start || b.end - a.end)
  const resolved: typeof candidates = []
  for (const sp of candidates) {
    if (resolved.some((x) => sp.start < x.end && sp.end > x.start)) continue
    resolved.push(sp)
  }
  if (!resolved.length) return null
  const usedIndexes = new Set(resolved.map((x) => x.targetIndex))
  const finalTargets = targets.filter((_, i) => usedIndexes.has(i))
  const remap = new Map<number, number>()
  finalTargets.forEach((_, finalIndex) => {
    const original = targets.indexOf(finalTargets[finalIndex])
    remap.set(original, finalIndex)
  })
  const spans = resolved.map((sp) => ({ ...sp, targetIndex: remap.get(sp.targetIndex) ?? 0 }))

  if (!opts.splitWords) {
    const parts: GoldenClozePart[] = []
    let pos = 0
    for (const sp of spans) {
      if (sp.start > pos) parts.push({ text: text.slice(pos, sp.start), blank: false })
      parts.push({
        text: text.slice(sp.start, sp.end),
        blank: true,
        targetIndex: sp.targetIndex,
        blankIndex: sp.targetIndex + 1,
      })
      pos = sp.end
    }
    if (pos < text.length) parts.push({ text: text.slice(pos), blank: false })
    const blanks: GoldenClozeBlank[] = finalTargets.map((t, i) => ({
      index: i + 1,
      targetIndex: i,
      answer: t.en,
      ...(t.zh ? { hint: t.zh } : {}),
      kind: t.kind,
    }))
    return { sentence: text, parts, blanks, targets: finalTargets }
  }

  const blanks: GoldenClozeBlank[] = []
  const blankByTargetWord = new Map<string, number>()
  const pieces: { start: number; end: number; targetIndex: number; blankIndex: number }[] = []
  for (const sp of spans) {
    const target = finalTargets[sp.targetIndex]
    if (!target) continue
    const words = wordSpans(sp.text)
    const units = words.length ? words : [{ start: 0, end: sp.text.length, text: sp.text }]
    units.forEach((w, wordIndex) => {
      const key = `${sp.targetIndex}|${wordIndex}`
      let blankIndex = blankByTargetWord.get(key)
      if (!blankIndex) {
        blankIndex = blanks.length + 1
        blankByTargetWord.set(key, blankIndex)
        blanks.push({
          index: blankIndex,
          targetIndex: sp.targetIndex,
          wordIndex,
          answer: w.text,
          ...(wordIndex === 0 && target.zh ? { hint: target.zh } : {}),
          kind: target.kind,
        })
      }
      pieces.push({
        start: sp.start + w.start,
        end: sp.start + w.end,
        targetIndex: sp.targetIndex,
        blankIndex,
      })
    })
  }
  pieces.sort((a, b) => a.start - b.start)
  const parts: GoldenClozePart[] = []
  let pos = 0
  for (const p of pieces) {
    if (p.start > pos) parts.push({ text: text.slice(pos, p.start), blank: false })
    parts.push({
      text: text.slice(p.start, p.end),
      blank: true,
      targetIndex: p.targetIndex,
      blankIndex: p.blankIndex,
    })
    pos = p.end
  }
  if (pos < text.length) parts.push({ text: text.slice(pos), blank: false })
  return { sentence: text, parts, blanks, targets: finalTargets }
}

export interface GoldenFillRound {
  /** 对应原句里的第几个语言点；整句渐进轮没有单一目标，固定 0 */
  targetIndex: number
  /** 从该语言点的第几个词开始（0 起） */
  wordFrom: number
  cloze: GoldenCloze
  /** target = 细碎语言点轮；sentence = 从单词到分句/整句的复述轮 */
  scope?: 'target' | 'sentence'
}

/** 整句渐进最多挖到多少词；更长的句子退化成「挖一个分句」，避免一次填一整段。 */
export const GOLDEN_SENTENCE_FILL_MAX_WORDS = 24

/** 只挖某个语言点的一段（从 wordFrom 到末尾），用于「先填 with，再填 up with」的细碎轮次。 */
function buildWordClozeForSpan(
  text: string,
  target: GoldenTarget,
  spanStart: number,
  spanEnd: number,
  wordFrom: number,
): GoldenCloze | null {
  const targetText = text.slice(spanStart, spanEnd)
  const words = wordSpans(targetText)
  if (!words.length || wordFrom < 0 || wordFrom >= words.length) return null
  const selected = words.slice(wordFrom)
  const blanks: GoldenClozeBlank[] = selected.map((w, i) => ({
    index: i + 1,
    targetIndex: 0,
    wordIndex: wordFrom + i,
    answer: w.text,
    ...(i === 0 && target.zh ? { hint: target.zh } : {}),
    kind: target.kind,
  }))
  const pieces = selected.map((w, i) => ({
    start: spanStart + w.start,
    end: spanStart + w.end,
    blankIndex: i + 1,
  }))
  const parts: GoldenClozePart[] = []
  let pos = 0
  for (const p of pieces) {
    if (p.start > pos) parts.push({ text: text.slice(pos, p.start), blank: false })
    parts.push({ text: text.slice(p.start, p.end), blank: true, targetIndex: 0, blankIndex: p.blankIndex })
    pos = p.end
  }
  if (pos < text.length) parts.push({ text: text.slice(pos), blank: false })
  return { sentence: text, parts, blanks, targets: [target] }
}

/**
 * 细碎填空轮次：一个语言点从最后一个词开始，逐步扩大后缀。
 * `keep up with` → `with` → `up with` → `keep up with`。
 */
export function buildGoldenFillRounds(text: string, targets: GoldenTarget[]): GoldenFillRound[] {
  const base = buildGoldenCloze(text, targets)
  if (!base) return []
  const rounds: GoldenFillRound[] = []
  base.targets.forEach((target, targetIndex) => {
    const span = findGoldenTargetSpans(text, target.en)[0]
    if (!span) return
    const words = wordSpans(span.text)
    if (!words.length) return
    for (let wordFrom = words.length - 1; wordFrom >= 0; wordFrom--) {
      const cloze = buildWordClozeForSpan(text, target, span.start, span.end, wordFrom)
      if (cloze) rounds.push({ targetIndex, wordFrom, cloze, scope: 'target' })
    }
  })
  return rounds
}

interface IndexedSpan {
  start: number
  end: number
  targetIndex: number
  target: GoldenTarget
}

function targetSpans(text: string, targets: GoldenTarget[]): IndexedSpan[] {
  return targets.flatMap((target, targetIndex) =>
    findGoldenTargetSpans(text, target.en).map((span) => ({ ...span, targetIndex, target })),
  )
}

/** 只挖指定词序号；用于「从单词到分句/整句」的复述轮。 */
function buildClozeForWordIndexes(
  text: string,
  targets: GoldenTarget[],
  words: { start: number; end: number; text: string }[],
  indexes: number[],
): GoldenCloze | null {
  const picked = [...new Set(indexes)].filter((i) => i >= 0 && i < words.length).sort((a, b) => a - b)
  if (!picked.length) return null
  const spans = targetSpans(text, targets)
  const blanks: GoldenClozeBlank[] = []
  const pieces: { start: number; end: number; targetIndex: number; blankIndex: number }[] = []
  for (const wordIndex of picked) {
    const word = words[wordIndex]
    const hit = spans.find((sp) => word.start >= sp.start && word.end <= sp.end)
    const targetIndex = hit?.targetIndex ?? 0
    const target = hit?.target ?? targets[0]
    const blankIndex = blanks.length + 1
    const hitWordIndex = hit
      ? wordSpans(text.slice(hit.start, hit.end)).findIndex((w) => hit.start + w.start === word.start)
      : -1
    blanks.push({
      index: blankIndex,
      targetIndex,
      ...(hitWordIndex >= 0 ? { wordIndex: hitWordIndex } : {}),
      answer: word.text,
      ...(hitWordIndex <= 0 && target?.zh ? { hint: target.zh } : {}),
      kind: target?.kind ?? 'word',
    })
    pieces.push({ start: word.start, end: word.end, targetIndex, blankIndex })
  }
  const parts: GoldenClozePart[] = []
  let pos = 0
  for (const p of pieces) {
    if (p.start > pos) parts.push({ text: text.slice(pos, p.start), blank: false })
    parts.push({ text: text.slice(p.start, p.end), blank: true, targetIndex: p.targetIndex, blankIndex: p.blankIndex })
    pos = p.end
  }
  if (pos < text.length) parts.push({ text: text.slice(pos), blank: false })
  return { sentence: text, parts, blanks, targets }
}

/** 词序号 → 目标覆盖到的词；重复出现的目标各自算一次。 */
function targetWordIndexes(text: string, targets: GoldenTarget[], words: { start: number; end: number }[]): number[] {
  const at = new Map(words.map((w, i) => [w.start, i]))
  const out = new Set<number>()
  for (const sp of targetSpans(text, targets)) {
    for (const w of wordSpans(text.slice(sp.start, sp.end))) {
      const index = at.get(sp.start + w.start)
      if (index !== undefined) out.add(index)
    }
  }
  return [...out].sort((a, b) => a - b)
}

/** 用标点把句子切成词序号区间；长句的最后一轮只挖一个分句。 */
function clauseIndexRanges(text: string, words: { start: number; end: number }[]): number[][] {
  if (words.length <= 1) return words.length ? [[0]] : []
  const ranges: number[][] = []
  let from = 0
  for (let i = 1; i < words.length; i++) {
    const gap = text.slice(words[i - 1].end, words[i].start)
    if (/[,;:—–]/.test(gap)) {
      ranges.push(Array.from({ length: i - from }, (_, k) => from + k))
      from = i
    }
  }
  ranges.push(Array.from({ length: words.length - from }, (_, k) => from + k))
  return ranges
}

/** 轮次去重指纹：空白位置 + 原文；只用于同一句内判重。 */
export function goldenClozeKey(cloze: GoldenCloze): string {
  return cloze.parts.map((p) => (p.blank ? `#${p.text}` : p.text)).join('')
}

/**
 * 整句复述轮：一个词 → 本句所有目标词 → 分句/整句。
 *
 * 已有填空轮是按语言点练；这组轮次把视野扩大到整句，最后让用户把整个分句
 * （长句）或整句（≤ 24 词）一次写出来。与前面的轮次重复时自动跳过。
 */
export function buildGoldenSentenceFillRounds(text: string, targets: GoldenTarget[]): GoldenFillRound[] {
  const words = wordSpans(text)
  if (!words.length) return []
  const targetIndexes = targetWordIndexes(text, targets, words)
  const focus = targetIndexes.length ? targetIndexes[targetIndexes.length - 1] : words.length - 1
  const indexSets: number[][] = [[focus]]
  if (targetIndexes.length > 1) indexSets.push(targetIndexes)
  let finalIndexes = words.map((_, i) => i)
  if (words.length > GOLDEN_SENTENCE_FILL_MAX_WORDS) {
    const ranges = clauseIndexRanges(text, words)
    const score = (range: number[]) => range.filter((i) => targetIndexes.includes(i)).length
    const best = [...ranges].sort((a, b) => score(b) - score(a) || b.length - a.length)[0]
    if (best?.length) finalIndexes = best
  }
  indexSets.push(finalIndexes)

  const rounds: GoldenFillRound[] = []
  const seen = new Set<string>()
  for (const indexes of indexSets) {
    const cloze = buildClozeForWordIndexes(text, targets, words, indexes)
    if (!cloze) continue
    const key = goldenClozeKey(cloze)
    if (seen.has(key)) continue
    seen.add(key)
    rounds.push({ targetIndex: 0, wordFrom: 0, cloze, scope: 'sentence' })
  }
  return rounds
}

export interface GoldenFillPlanOptions {
  /** `target` = 一个语言点一个空；`word` = 先按词细碎轮，默认 word */
  blankUnit?: 'word' | 'target'
  /** 是否在语言点轮后追加「单词 → 目标词 → 分句/整句」；默认开 */
  sentenceFill?: boolean
}

/**
 * 一句金句的完整填空计划：语言点轮 + 整句渐进轮，同一组空只出现一次。
 *
 * 轮次规则只在这里拼装；hook 不再自己组合两套 builder。
 */
export function buildGoldenFillPlan(
  text: string,
  targets: GoldenTarget[],
  opts: GoldenFillPlanOptions = {},
): GoldenFillRound[] {
  const targetRounds =
    opts.blankUnit === 'target'
      ? (() => {
          const cloze = buildGoldenCloze(text, targets)
          return cloze ? [{ targetIndex: 0, wordFrom: 0, cloze, scope: 'target' as const }] : []
        })()
      : buildGoldenFillRounds(text, targets)
  if (opts.sentenceFill === false) return targetRounds
  const seen = new Set(targetRounds.map((r) => goldenClozeKey(r.cloze)))
  const extra = buildGoldenSentenceFillRounds(text, targets).filter((r) => {
    const key = goldenClozeKey(r.cloze)
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
  return [...targetRounds, ...extra]
}

/** 一个空是否正确：忽略大小写/首尾标点/空白；连字符和撇号也宽容。 */
export function isGoldenBlankCorrect(blank: GoldenClozeBlank, input: string): boolean {
  const n = normalizeAnswer(input)
  if (!n) return false
  const a = normalizeAnswer(blank.answer)
  return n === a || canonical(n) === canonical(a)
}

export function checkGoldenFill(cloze: GoldenCloze, inputs: string[]): boolean[] {
  return cloze.blanks.map((b) => isGoldenBlankCorrect(b, inputs[b.index - 1] ?? ''))
}

export function goldenFillAllCorrect(results: boolean[]): boolean {
  return results.length > 0 && results.every(Boolean)
}

export interface GoldenAssembly {
  cloze: GoldenCloze
  /** 打乱后的目标英文；点选后按空顺序拼回 */
  bank: string[]
}

/** 拼句银行：同一组目标打乱；用句子文本做种子，刷新不跳。 */
export function buildGoldenAssembly(text: string, targets: GoldenTarget[]): GoldenAssembly | null {
  const cloze = buildGoldenCloze(text, targets)
  if (!cloze) return null
  const seed = [...text].reduce((a, ch) => (a * 31 + ch.charCodeAt(0)) >>> 0, 7)
  const rnd = (() => {
    let x = seed || 1
    return () => {
      x ^= x << 13
      x ^= x >>> 17
      x ^= x << 5
      return ((x >>> 0) % 1_000_000) / 1_000_000
    }
  })()
  return { cloze, bank: shuffleQuiz(targets.map((t) => t.en), rnd) }
}

export function checkGoldenAssembly(targets: GoldenTarget[], order: string[]): boolean {
  if (order.length !== targets.length) return false
  return order.every((v, i) => {
    const a = normalizeAnswer(targets[i].en)
    const b = normalizeAnswer(v)
    return a === b || canonical(a) === canonical(b)
  })
}

export interface GoldenRecallResult {
  closeness: Closeness
  diff: DiffPart[]
  /** 首次作答是否算“掌握”：原句或接近原句 */
  firstOk: boolean
}

/** 逆向默写：严格按原句（exact / near ≥ 0.9）；自评只影响完成，不影响掌握。 */
export function checkGoldenRecall(input: string, reference: string): GoldenRecallResult {
  const closeness = compareToReference(input, reference)
  return {
    closeness,
    diff: diffWords(input, reference),
    firstOk: !!input.trim() && (closeness.exact || closeness.tier === 'near'),
  }
}
