import { compareToReference, diffWords, type Closeness, type DiffPart } from './backTranslate'
import { findGoldenTargetSpans } from './golden'
import { normalizeAnswer, shuffleQuiz } from './quiz'
import { canonical } from './quizParts'
import type { GoldenTarget, GoldenTargetKind } from '../types/document'

/** 金句课的三种练习：挖空、拼句、逆向默写；只做判分/构造，不碰会话状态。 */

export interface GoldenClozeBlank {
  /** 目标序号（1 起）；同一目标出现多次，属于同一个空 */
  index: number
  targetIndex: number
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

/** 把目标在句子里挖空；同一目标的所有出现位置共用一个输入。 */
export function buildGoldenCloze(text: string, targets: GoldenTarget[]): GoldenCloze | null {
  const found = targets
    .map((target) => ({ target, spans: findGoldenTargetSpans(text, target.en) }))
    .filter((x) => x.spans.length > 0)
  if (!found.length) return null
  const used = found.map((x) => x.target)
  const spans: { start: number; end: number; targetIndex: number }[] = []
  found.forEach((x, ti) => {
    for (const sp of x.spans) spans.push({ start: sp.start, end: sp.end, targetIndex: ti })
  })
  spans.sort((a, b) => a.start - b.start || b.end - a.end)
  const resolved: typeof spans = []
  for (const sp of spans) {
    if (resolved.some((x) => sp.start < x.end && sp.end > x.start)) continue
    resolved.push(sp)
  }
  if (!resolved.length) return null
  const usedIndexes = new Set(resolved.map((x) => x.targetIndex))
  const finalTargets = used.filter((_, i) => usedIndexes.has(i))
  const remap = new Map<number, number>()
  finalTargets.forEach((_, i) => {
    const original = used.findIndex((t) => t === finalTargets[i])
    remap.set(original, i)
  })
  const parts: GoldenClozePart[] = []
  let pos = 0
  for (const sp of resolved) {
    if (sp.start > pos) parts.push({ text: text.slice(pos, sp.start), blank: false })
    const ti = remap.get(sp.targetIndex) ?? 0
    parts.push({
      text: text.slice(sp.start, sp.end),
      blank: true,
      targetIndex: ti,
      blankIndex: ti + 1,
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

/** 一个空是否正确：忽略大小写/首尾标点/空白；连字符和撇号也宽容。 */
export function isGoldenBlankCorrect(blank: GoldenClozeBlank, input: string): boolean {
  const n = normalizeAnswer(input)
  if (!n) return false
  const a = normalizeAnswer(blank.answer)
  return n === a || canonical(n) === canonical(a)
}

export function checkGoldenFill(cloze: GoldenCloze, inputs: string[]): boolean[] {
  return cloze.blanks.map((b) => isGoldenBlankCorrect(b, inputs[b.targetIndex] ?? ''))
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
