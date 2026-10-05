/**
 * 离线词典（数据来自 ECDICT，经 tools/build-ecdict.mjs 预处理）。
 *
 * 纯逻辑：解析紧凑 TSV、查词、词形→原形、判断"是否超出某词汇水平"。
 * 网络加载放在 reader/dictionary.ts（这里不碰浏览器 API，便于单测）。
 */

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
}

/** 还原转义：\\n → 换行、\\t → 制表、\\\\ → 反斜杠。 */
function unesc(s: string): string {
  return s.replace(/\\n/g, '\n').replace(/\\t/g, '\t').replace(/\\\\/g, '\\')
}

/** 解析构建脚本产出的两个 TSV。 */
export function parseEcdict(wordsTsv: string, formsTsv: string): Ecdict {
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
  return { entries, forms }
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

export type EcdictLevel = 'cet4' | 'cet6' | 'kaoyan' | 'ielts' | 'ielts65'

/** 各档"以内"包含哪些标签（超出这些即算超纲）。 */
const WITHIN: Record<EcdictLevel, string[]> = {
  cet4: ['zk', 'gk', 'cet4'],
  cet6: ['zk', 'gk', 'cet4', 'cet6'],
  kaoyan: ['zk', 'gk', 'cet4', 'cet6', 'ky'],
  ielts: ['zk', 'gk', 'cet4', 'cet6', 'ielts'],
  ielts65: ['zk', 'gk', 'cet4', 'cet6', 'ielts', 'toefl'],
}

/** 是否"超出某词汇水平"（词典里有、且不属于该档、且是常用词）。 */
export function isAboveLevel(dict: Ecdict, word: string, level: EcdictLevel): boolean {
  const hit = resolveWord(dict, word)
  if (!hit) return false
  const tags = hit.entry.tag.split(/\s+/).filter(Boolean)
  if (WITHIN[level].some((t) => tags.includes(t))) return false
  // 排除过于生僻的：要有标签或高频/柯林斯/牛津
  return tags.length > 0 || hit.entry.collins >= 1 || hit.entry.oxford === 1 || hit.entry.frq > 0
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

/** 从一段英文里挑"超出某水平"的词（按出现顺序、去重、返回原形）。纯本地，不用 AI。 */
export function pickAboveLevelWords(dict: Ecdict, text: string, level: EcdictLevel, max = 40): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const m of text.matchAll(WORD_RE)) {
    const surface = m[0]
    const lower = surface.toLowerCase()
    if (seen.has(lower)) continue
    seen.add(lower)
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
