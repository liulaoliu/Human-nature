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
  /** 对应原句里的第几个语言点 */
  targetIndex: number
  /** 从该语言点的第几个词开始（0 起） */
  wordFrom: number
  cloze: GoldenCloze
}

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
      if (cloze) rounds.push({ targetIndex, wordFrom, cloze })
    }
  })
  return rounds
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
