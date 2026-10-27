import { getSentenceLanguages } from './language'
import { splitGlossText } from './langPoints'
import { normalizeAnswer } from './quiz'
import { wordSpans } from './wordSelect'
import type {
  GoldenLesson,
  GoldenSection,
  GoldenSentence,
  GoldenTarget,
  GoldenTargetKind,
  Paragraph,
  Sentence,
} from '../types/document'

/**
 * 「D老师小课堂」金句课：纯逻辑层。
 *
 * 一条学习链：预览整句 → 句子填空 → 拼接整句 → 本句小结 → 逆向回顾。
 * 这里只做「算」：选金句、抽目标、挖空、拼句银行、判分、回忆 diff、掌握统计；
 * React / 存储 / TTS 一律不碰（R1）。
 */

export const GOLDEN_DEFAULT_LIMIT = 10
export const GOLDEN_MAX_LIMIT = 20
/** 逆向默写「接近」的阈值；低于它只能算完成，不能算掌握。 */
export const GOLDEN_RECALL_NEAR = 0.9

export const GOLDEN_TARGET_KIND_LABEL: Record<GoldenTargetKind, string> = {
  pattern: '句型',
  tense: '时态',
  collocation: '搭配',
  idiom: '习语',
  usage: '用法',
  word: '单词',
}

export interface GoldenTextMeta {
  id: string
  text: string
  translation?: string | null
}

export interface GoldenCandidate {
  id: string
  index: number
  score: number
  reasons: string[]
}

/** 一句最多练多少个目标；只防 AI/坏数据无限塞，不再把正常语言点截到 6 个。 */
export const GOLDEN_TARGET_LIMIT = 20
const TENSE_AUX = new Set(['has', 'have', 'had', 'is', 'are', 'was', 'were', 'am'])
const MODAL = new Set(['will', 'would', 'can', 'could', 'may', 'might', 'must', 'should'])
const STOP = new Set([
  'the', 'a', 'an', 'and', 'or', 'but', 'of', 'to', 'in', 'on', 'at', 'for', 'with', 'by', 'from',
  'as', 'is', 'are', 'was', 'were', 'be', 'been', 'being', 'it', 'its', 'this', 'that', 'these',
  'those', 'i', 'you', 'he', 'she', 'we', 'they', 'his', 'her', 'their', 'our', 'your', 'my',
  'me', 'him', 'them', 'us', 'not', 'no', 'so', 'if', 'than', 'then', 'when', 'while', 'into',
  'over', 'under', 'also', 'more', 'most', 'much', 'many', 'very', 'can', 'could', 'will',
  'would', 'should', 'may', 'might', 'must', 'do', 'does', 'did', 'has', 'have', 'had', 'there',
  'here', 'what', 'which', 'who', 'whom', 'how', 'why', 'all', 'any', 'some', 'such', 'only',
  'just',
])

export function isObject(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v)
}

export function str(v: unknown): string {
  return typeof v === 'string' ? v.trim() : ''
}

export function strList(v: unknown): string[] {
  return Array.isArray(v) ? v.map(str).filter(Boolean) : []
}

/** djb2：短、稳定、不用引第三方；只用于内容指纹，不用于安全。 */
function hashText(s: string): string {
  let h = 5381
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0
  return (h >>> 0).toString(36)
}

export function goldenTargetKey(t: Pick<GoldenTarget, 'en' | 'kind'>): string {
  return `${t.kind}|${normalizeAnswer(t.en)}`
}

/** 句子 + 目标的内容指纹：改正文或改目标后，旧进度不会误用。 */
export function goldenDrillKey(text: string, targets: GoldenTarget[]): string {
  const keys = targets.map((t) => `${t.kind}:${normalizeAnswer(t.en)}`).join('\u0001')
  return hashText(`${text.trim()}\u0002${keys}`)
}

export function goldenRecordId(articleId: string, sentenceId: string, drillKey: string): string {
  return `${articleId}|${sentenceId}|${drillKey}`
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * 找目标在原文里的所有出现位置。
 *
 * 只容忍大小写、撇号/连字符变体与空白差异；不允许把词的一部分当目标
 *（`norm` 不能命中 `normal`）。找不到就返回空数组，调用方丢弃该目标。
 */
export function findGoldenTargetSpans(text: string, en: string): { start: number; end: number; text: string }[] {
  const raw = en.trim()
  if (!raw || !text) return []
  const body = raw
    .split(/\s+/)
    .map((part) =>
      escapeRegExp(part)
        .replace(/['’]/g, "['’]")
        .replace(/[-–—]/g, '[-–—]'),
    )
    .join('\\s+')
  let re: RegExp
  try {
    re = new RegExp(`(?<![\\p{L}\\p{N}])${body}(?![\\p{L}\\p{N}])`, 'giu')
  } catch {
    return []
  }
  const out: { start: number; end: number; text: string }[] = []
  let m: RegExpExecArray | null
  while ((m = re.exec(text))) {
    if (m[0]) out.push({ start: m.index, end: m.index + m[0].length, text: m[0] })
    if (re.lastIndex === m.index) re.lastIndex += 1
  }
  return out
}

function firstSpan(text: string, en: string): { start: number; end: number; text: string } | null {
  return findGoldenTargetSpans(text, en)[0] ?? null
}

function normalizeKind(v: unknown): GoldenTargetKind | null {
  return typeof v === 'string' && v in GOLDEN_TARGET_KIND_LABEL ? (v as GoldenTargetKind) : null
}

/**
 * 目标清洗：必须在原句里逐字出现；去重；重叠时长的优先；最多 6 个。
 * AI 返回的编造片段、备份里的坏数据都在这里被丢掉。
 */
export function normalizeGoldenTargets(text: string, raw: unknown): GoldenTarget[] {
  if (!Array.isArray(raw)) return []
  const kept: { target: GoldenTarget; span: { start: number; end: number } }[] = []
  const seen = new Set<string>()
  for (const item of raw) {
    if (!isObject(item)) continue
    const en = str(item.en)
    if (!en) continue
    const kind = normalizeKind(item.kind) ?? 'word'
    const key = `${kind}|${normalizeAnswer(en)}`
    if (seen.has(key)) continue
    const span = firstSpan(text, en)
    if (!span) continue
    const target: GoldenTarget = { en, kind, ...(str(item.zh) ? { zh: str(item.zh) } : {}) }
    seen.add(key)
    kept.push({ target, span })
  }
  // 先按长度挑重叠项（长语言点优先于被它包住的短词/时态），再按原句顺序输出。
  kept.sort(
    (a, b) =>
      b.span.end - b.span.start - (a.span.end - a.span.start) ||
      a.span.start - b.span.start,
  )
  const out: { target: GoldenTarget; span: { start: number; end: number } }[] = []
  for (const row of kept) {
    if (out.some((x) => row.span.start < x.span.end && row.span.end > x.span.start)) continue
    out.push(row)
  }
  out.sort((a, b) => a.span.start - b.span.start)
  return out.slice(0, GOLDEN_TARGET_LIMIT).map((x) => x.target)
}

/** 本地兜底：语言点词组/习语 → 保守时态块 → 生词 → 较长的实词。 */
export function buildLocalTargets(sentence: Sentence, meanings?: Record<string, string>): GoldenTarget[] {
  const text = sentence.text
  const raw: GoldenTarget[] = []
  for (const L of getSentenceLanguages(sentence)) {
    for (const p of L.phrases ?? []) {
      const { word, gloss } = splitGlossText(p)
      if (word) raw.push({ en: word, ...(gloss ? { zh: gloss } : {}), kind: 'collocation' })
    }
    for (const i of L.idioms ?? []) {
      const { word, gloss } = splitGlossText(i)
      if (word) raw.push({ en: word, ...(gloss ? { zh: gloss } : {}), kind: 'idiom' })
    }
  }
  for (const c of sentence.collocations ?? []) {
    raw.push({ en: c, kind: 'collocation' })
  }
  // 保守时态：have/has/had + 实词；be + -ing/-ed。宁可少抽，也别把 is one 当“时态”。
  const spans = wordSpans(text)
  for (let i = 0; i < spans.length - 1; i++) {
    const w = spans[i].text.replace(/[^A-Za-z']/g, '')
    const next = spans[i + 1].text.replace(/[^A-Za-z']/g, '')
    if (!w || !next) continue
    const low = w.toLowerCase()
    const nextLow = next.toLowerCase()
    const usefulNext = next.length >= 3 && !STOP.has(nextLow)
    if ((TENSE_AUX.has(low) && usefulNext && (low.startsWith('ha') || /(ing|ed)$/.test(nextLow))) || (MODAL.has(low) && usefulNext)) {
      const from = spans[i].start
      const to = spans[i + 1].end
      raw.push({ en: text.slice(from, to), kind: 'tense' })
    }
  }
  for (const v of sentence.vocab ?? []) {
    const key = v.trim().toLowerCase()
    raw.push({ en: v, ...(meanings?.[key] ? { zh: meanings[key] } : {}), kind: 'word' })
  }
  if (!raw.length) {
    const words = spans
      .map((s) => s.text.replace(/[^A-Za-z'-]/g, ''))
      .filter((w) => w.length >= 5 && !STOP.has(w.toLowerCase()))
      .sort((a, b) => b.length - a.length)
      .slice(0, 3)
    for (const w of words) raw.push({ en: w, ...(meanings?.[w.toLowerCase()] ? { zh: meanings[w.toLowerCase()] } : {}), kind: 'word' })
  }
  return normalizeGoldenTargets(text, raw)
}

export function goldenSectionRole(index: number, total: number): GoldenSection['role'] {
  if (total <= 1) return 'intro'
  if (index <= 0) return 'intro'
  if (index >= total - 1) return 'conclusion'
  return 'body'
}

/** 由段落 / 句子生成文章脉络；没有段落时整篇算一段。 */
export function buildGoldenOutline(
  paragraphs: Paragraph[] | undefined,
  sentences: Sentence[],
  lesson?: Pick<GoldenLesson, 'sentences'> | null,
): GoldenSection[] {
  const byId = new Map(sentences.map((s) => [s.id, s]))
  const content = new Map((lesson?.sentences ?? []).map((s) => [s.id, s]))
  const groups = paragraphs?.length
    ? paragraphs.map((p) => ({ paraId: p.id, ids: p.sentenceIds }))
    : sentences.length
      ? [{ paraId: 'p01', ids: sentences.map((s) => s.id) }]
      : []
  return groups.map((g, i) => {
    const first = g.ids.map((id) => byId.get(id)).find(Boolean)
    const points = g.ids
      .map((id) => byId.get(id))
      .filter((s): s is Sentence => !!s)
      .map((s) => content.get(s.id)?.zh || s.translation || '')
      .filter(Boolean)
      .slice(0, 2)
    return {
      paraId: g.paraId,
      role: goldenSectionRole(i, groups.length),
      points: points.length ? points : first ? [first.text] : [],
    }
  })
}

function scoreSentence(s: Sentence): { score: number; reasons: string[] } {
  const reasons: string[] = []
  let score = 0
  const languages = getSentenceLanguages(s)
  const phrases = languages.flatMap((l) => l.phrases ?? [])
  const idioms = languages.flatMap((l) => l.idioms ?? [])
  if (languages.length) {
    score += 2
    reasons.push('有语言点')
  }
  if (phrases.length) {
    score += Math.min(3, phrases.length)
    reasons.push(`${phrases.length} 个词组`)
  }
  if (idioms.length) {
    score += 2
    reasons.push('习语')
  }
  if (languages.some((l) => (l.grammar ?? '').trim())) {
    score += 1
    reasons.push('时态/语法')
  }
  if ((s.translation ?? '').trim()) score += 1
  else reasons.push('缺译文')
  if ((s.collocations ?? []).length) {
    score += 1
    reasons.push('搭配')
  }
  if ((s.vocab ?? []).length) {
    score += 1
    reasons.push('生词')
  }
  const n = wordSpans(s.text).length
  if (n >= 8 && n <= 40) score += 1
  if (n > 45) score -= 1
  return { score, reasons }
}

/** 金句候选：按“有语言点/搭配/生词/长度合适”打分；同分按原文顺序。 */
export function rankGoldenCandidates(sentences: Sentence[]): GoldenCandidate[] {
  const seen = new Set<string>()
  const out: GoldenCandidate[] = []
  sentences.forEach((s, index) => {
    const text = s.text.trim()
    if (!text || seen.has(text)) return
    seen.add(text)
    const { score, reasons } = scoreSentence(s)
    out.push({ id: s.id, index, score, reasons })
  })
  return out.sort((a, b) => b.score - a.score || a.index - b.index)
}

export function pickGoldenCandidates(sentences: Sentence[], limit = GOLDEN_DEFAULT_LIMIT): GoldenCandidate[] {
  const max = Math.max(1, Math.min(GOLDEN_MAX_LIMIT, limit))
  return rankGoldenCandidates(sentences).slice(0, max)
}

export function buildLocalGoldenSentence(sentence: Sentence, meanings?: Record<string, string>): GoldenSentence {
  const languages = getSentenceLanguages(sentence)
  const grammar = languages.map((l) => (l.grammar ?? '').trim()).filter(Boolean).join('；')
  const structure = languages.map((l) => (l.structure ?? '').trim()).filter(Boolean).join('；')
  const usage = languages.flatMap((l) => l.usage ?? []).filter(Boolean)
  return {
    id: sentence.id,
    ...(sentence.translation?.trim() ? { zh: sentence.translation.trim() } : {}),
    ...(structure ? { pattern: structure } : {}),
    ...(grammar ? { tense: grammar } : {}),
    ...(usage.length ? { note: usage.join('；') } : {}),
    targets: buildLocalTargets(sentence, meanings),
  }
}

export interface LocalGoldenOptions {
  limit?: number
  selected?: string[]
  meanings?: Record<string, string>
  dedupe?: boolean
  /** 填空单位：一个词一个空（默认）或一个语言点一个空 */
  blankUnit?: 'word' | 'target'
}

/** 没有 AI 也能用的金句课：结构、金句、目标全部由现有译文/语言点推导。 */
export function buildLocalGoldenLesson(
  sentences: Sentence[],
  paragraphs?: Paragraph[],
  opts: LocalGoldenOptions = {},
): GoldenLesson {
  const limit = opts.limit ?? GOLDEN_DEFAULT_LIMIT
  const picked = opts.selected?.length
    ? opts.selected
        .map((id) => sentences.find((s) => s.id === id))
        .filter((s): s is Sentence => !!s)
    : pickGoldenCandidates(sentences, limit)
        .map((c) => sentences[c.index])
        .filter((s): s is Sentence => !!s)
  const order = new Map(sentences.map((s, i) => [s.id, i]))
  const content = picked
    .map((s) => buildLocalGoldenSentence(s, opts.meanings))
    .sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0))
  const lesson: GoldenLesson = {
    version: 1,
    source: 'local',
    outline: buildGoldenOutline(paragraphs, sentences, { sentences: content }),
    sentences: content,
    selected: content.map((s) => s.id),
    options: {
      dedupe: !!opts.dedupe,
      pick: opts.selected?.length ? 'manual' : 'recommended',
      blankUnit: opts.blankUnit ?? 'word',
    },
  }
  return opts.dedupe ? dedupeGoldenLesson(lesson) : lesson
}

/**
 * 打开“本课去重”只改设置，**不改内容**：真正过滤发生在取目标时
 *（`goldenTargetsFor`），这样用户关掉开关还能恢复完整目标。
 */
export function dedupeGoldenLesson(lesson: GoldenLesson): GoldenLesson {
  return { ...lesson, options: { ...lesson.options, dedupe: true } }
}

/**
 * 某句实际要练的目标：去重开启时，同一目标只在第一句（按 selected 顺序）
 * 出现的地方保留；后面句子跳过它。默认按句独立，直接返回全部目标。
 */
export function goldenTargetsFor(lesson: GoldenLesson, sentenceId: string): GoldenTarget[] {
  const s = lesson.sentences.find((x) => x.id === sentenceId)
  if (!s) return []
  if (lesson.options?.dedupe !== true) return s.targets
  const order = lesson.selected.length ? lesson.selected : lesson.sentences.map((x) => x.id)
  const seen = new Set<string>()
  for (const id of order) {
    const cur = lesson.sentences.find((x) => x.id === id)
    if (!cur) continue
    if (id === sentenceId) {
      return cur.targets.filter((t) => {
        const key = goldenTargetKey(t)
        if (seen.has(key)) return false
        seen.add(key)
        return true
      })
    }
    for (const t of cur.targets) seen.add(goldenTargetKey(t))
  }
  return s.targets
}
