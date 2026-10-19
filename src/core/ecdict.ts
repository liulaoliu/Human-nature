/**
 * 离线词典（数据来自 ECDICT，经 tools/build-ecdict.mjs 预处理）。
 *
 * 纯逻辑：解析紧凑 TSV、查词、词形→原形、判断"是否超出某词汇水平"。
 * 网络加载放在 adapters/dictionary.ts（这里不碰浏览器 API，便于单测）。
 */
import { kindOf } from './entryKind'
import { normalizeWord } from './vocab'
import type { VocabKind } from '../types/document'

export interface EcdictEntry {
  /** 原词形（显示用） */
  word: string
  phonetic: string
  pos: string
  /** 英文释义（可能多行，用 \n 连接，带 n./v./a. 前缀） */
  en: string
  /** 中文释义（可能多行） */
  zh: string
  /** 分级标签，空格分隔：zk gk cet4 cet6 ky toefl ielts gre */
  tag: string
  collins: number
  oxford: number
  bnc: number
  frq: number
}

export interface Ecdict {
  /** lower(word) → 词条（仅常用词） */
  entries: Map<string, EcdictEntry>
  /** lower(词形) → lower(原形) */
  forms: Map<string, string>
  /** lower(word) → 拼写近邻候选（用于本地生成混淆项） */
  near: Map<string, string[]>
}

/** 还原转义：\\n → 换行、\\t → 制表、\\\\ → 反斜杠。 */
function unesc(s: string): string {
  return s.replace(/\\n/g, '\n').replace(/\\t/g, '\t').replace(/\\\\/g, '\\')
}

/** 解析构建脚本产出的两个 TSV。 */
export function parseEcdict(wordsTsv: string, formsTsv: string, nearTsv = ''): Ecdict {
  const entries = new Map<string, EcdictEntry>()
  for (const line of wordsTsv.split('\n')) {
    if (!line) continue
    const c = line.split('\t')
    if (c.length < 2 || c[0] === 'word') continue
    const word = c[0]
    entries.set(word.toLowerCase(), {
      word,
      phonetic: unesc(c[1] ?? ''),
      pos: unesc(c[2] ?? ''),
      en: unesc(c[3] ?? ''),
      zh: unesc(c[4] ?? ''),
      tag: unesc(c[5] ?? ''),
      collins: Number(c[6] || 0),
      oxford: Number(c[7] || 0),
      bnc: Number(c[8] || 0),
      frq: Number(c[9] || 0),
    })
  }
  const forms = new Map<string, string>()
  for (const line of formsTsv.split('\n')) {
    if (!line) continue
    const i = line.indexOf('\t')
    if (i <= 0) continue
    forms.set(line.slice(0, i), line.slice(i + 1))
  }
  const near = new Map<string, string[]>()
  for (const line of nearTsv.split('\n')) {
    if (!line) continue
    const i = line.indexOf('\t')
    if (i <= 0) continue
    near.set(
      line.slice(0, i),
      line.slice(i + 1).split(',').filter(Boolean),
    )
  }
  return { entries, forms, near }
}

/** 查词：按词形先还原原形，再取词条。返回 { lemma, entry }，查不到为 null。 */
export function resolveWord(dict: Ecdict, word: string): { lemma: string; entry: EcdictEntry } | null {
  const lower = word.trim().toLowerCase()
  if (!lower) return null
  const lemma = dict.forms.get(lower) ?? lower
  const entry = dict.entries.get(lemma) ?? dict.entries.get(lower)
  if (!entry) return null
  return { lemma, entry }
}

/** 只取原形（词典里没有则返回 null）。 */
export function dictLemmaOf(dict: Ecdict, word: string): string | null {
  const lower = word.trim().toLowerCase()
  if (!lower) return null
  const lemma = dict.forms.get(lower)
  if (lemma) return lemma
  return dict.entries.has(lower) ? lower : null
}

/**
 * 这个词条能不能交给**单词**词典做词形归并。
 *
 * 只有「单个英文单词」才算：词组 / 习语 / 用法笔记不做（词典里没有它们的词形表，
 * 而且 `lemmaOf` 对含空格的东西本来就是「原样」——把它们并进某个单词，
 * 「语言点自动收藏」下一轮又会加回来，两边来回打架、词库数量就会跳）。
 */
export function isDictWord(item: { word: string; lemma?: string; kind?: VocabKind }): boolean {
  if (kindOf(item) !== 'word') return false
  const w = normalizeWord(item.word)
  return !!w && !w.includes(' ')
}

/** 由词库 + 词典算出「词形 → 原形」的修正对（幂等）。只处理单个英文单词，见 `isDictWord`。 */
export function dictLemmaPairs(
  dict: Ecdict,
  items: { word: string; lemma?: string; kind?: VocabKind; status?: string }[],
  opts: { skipLocked?: boolean } = {},
): { from: string; to: string }[] {
  const out: { from: string; to: string }[] = []
  for (const it of items) {
    if (opts.skipLocked && (it.status === 'edited' || it.status === 'mastered')) continue
    if (!isDictWord(it)) continue
    const to = dictLemmaOf(dict, it.word)
    if (!to || normalizeWord(it.word) === to) continue
    out.push({ from: it.word, to })
  }
  return out
}

export interface DictConfusable {
  word: string
  meaning?: string
}

/** 用词典给一个词挑拼写近邻（形近、义不同）作选择题干扰项。 */
export function dictConfusables(dict: Ecdict, word: string, n = 3): DictConfusable[] {
  const lemma = dictLemmaOf(dict, word) ?? word.trim().toLowerCase()
  const cands = dict.near.get(lemma) ?? []
  const out: DictConfusable[] = []
  for (const c of cands) {
    const e = dict.entries.get(c)
    if (!e) continue
    out.push({ word: e.word, meaning: firstLine(e.zh) || undefined })
    if (out.length >= n) break
  }
  return out
}

export type EcdictLevel = 'cet4' | 'cet6' | 'kaoyan' | 'ielts' | 'ielts65'

/** 各档"以内"包含哪些标签（超出这些即算超纲）。 */
const WITHIN: Record<EcdictLevel, string[]> = {
  cet4: ['zk', 'gk', 'cet4'],
  cet6: ['zk', 'gk', 'cet4', 'cet6'],
  kaoyan: ['zk', 'gk', 'cet4', 'cet6', 'ky'],
  ielts: ['zk', 'gk', 'cet4', 'cet6', 'ielts'],
  ielts65: ['zk', 'gk', 'cet4', 'cet6', 'ielts', 'toefl'],
}

/** 分级判定结果。 */
export type LevelVerdict = 'above' | 'within' | 'rare' | 'unknown'

/**
 * 无级别标签的词，用词频排名兜底：排名 ≤ 这个数（越大越生僻）算「常见词」，不算超纲。
 * 治的是 `entirely / john / killer` 这类 ECDICT 漏标的基本词。
 */
const CORE_FREQ_RANK = 5000

/**
 * 判定一个词相对某词汇水平的位置：
 *   - `above`   超纲（该留）
 *   - `within`  在档内 / 属于基础常见词（不该留）
 *   - `rare`    词典里是「太生僻」（无标签/无频次）
 *   - `unknown` 词典里根本没收录 —— **不能因此判定它不超纲**
 */
export function levelVerdict(dict: Ecdict, word: string, level: EcdictLevel): LevelVerdict {
  const hit = resolveWord(dict, word)
  if (!hit) return 'unknown'
  const e = hit.entry
  const tags = e.tag.split(/\s+/).filter(Boolean)
  if (WITHIN[level].some((t) => tags.includes(t))) return 'within'
  // 无级别标签 → 用词频排名兜底（ECDICT 标签不全，entirely/整类基础词常没标签）
  if (!tags.length) {
    const ranks = [e.bnc, e.frq].filter((n) => n > 0)
    if (ranks.length && Math.min(...ranks) <= CORE_FREQ_RANK) return 'within'
  }
  const common = tags.length > 0 || e.collins >= 1 || e.oxford === 1 || e.frq > 0 || e.bnc > 0
  return common ? 'above' : 'rare'
}

/** 是否"超出某词汇水平"（词典里有、且不属于该档、且是常用词）。 */
export function isAboveLevel(dict: Ecdict, word: string, level: EcdictLevel): boolean {
  return levelVerdict(dict, word, level) === 'above'
}

/** 首行非空文本（ECDICT 的中英释义都是多行）。 */
export function firstLine(s: string): string {
  for (const line of s.split('\n')) {
    const t = line.trim()
    if (t) return t
  }
  return ''
}

const WORD_RE = /[A-Za-z][A-Za-z'-]*/g

/** 这个位置是不是「句首」（前一个非空白字符是句末标点/引号，或文本开头）。 */
function isSentenceStart(text: string, index: number): boolean {
  let i = index - 1
  while (i >= 0 && /\s/.test(text[i])) i--
  if (i < 0) return true
  return /[.!?…。！？"'“”‘’)\]】）]/.test(text[i])
}

/**
 * 从一段英文里挑"超出某水平"的词（按出现顺序、去重、返回原形）。纯本地，不用 AI。
 *
 * 会跳过**句中大写**的词（`Trump` / `Islamic` / `CIA` 这类专有名词），
 * 但句首大写照常收（那可能只是句首字母大写）。
 */
export function pickAboveLevelWords(dict: Ecdict, text: string, level: EcdictLevel, max = 40): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const m of text.matchAll(WORD_RE)) {
    const surface = m[0]
    const lower = surface.toLowerCase()
    if (seen.has(lower)) continue
    seen.add(lower)
    // 句中大写 → 多半是专有名词，跳过；全大写缩写（CIA / NATO）也跳过
    if (/^[A-Z]{2,}$/.test(surface)) continue
    if (/^[A-Z]/.test(surface) && !isSentenceStart(text, m.index)) continue
    const hit = resolveWord(dict, surface)
    if (!hit) continue
    if (hit.lemma.length < 3) continue
    if (!isAboveLevel(dict, surface, level)) continue
    if (out.includes(hit.lemma)) continue
    out.push(hit.lemma)
    if (out.length >= max) break
  }
  return out
}
