import type { Sentence, SentenceLanguage } from '../types/document'

/**
 * 逐句语言点分析：AI 结构化输出「结构 / 语法 / idiom / 词组 / 用法」，写回句子。
 *
 * 写的地基：先把每个句子的语言点讲清楚，之后仿写才有依据。
 * 提示词要求严格 JSON；解析层校验并丢弃不合格项。
 */

export interface LanguageRow extends SentenceLanguage {
  id: string
}

/** 老数据里列表字段可能是「；/换行」连成的字符串；统一成去重后的数组。 */
function termsOf(v: unknown): string[] | undefined {
  if (Array.isArray(v)) {
    const out = v.map((x) => (typeof x === 'string' ? x.trim() : '')).filter(Boolean)
    return out.length ? out : undefined
  }
  if (typeof v === 'string') {
    const out = splitLanguageList(v)
    return out.length ? out : undefined
  }
  return undefined
}

/**
 * 一条语言点的兼容层：老数据（单条 `language`、列表字段是字符串、缺字段）与
 * AI / 手动写入的新数据都归一成 `SentenceLanguage`；没内容的返回 null。
 *
 * **编辑旧数据就靠这里**：视图只吃归一后的结果，`languageToForm` 不用再判断老形状。
 * 结构 / 语法只裁掉「全是空白」的，内部换行与行首缩进原样保留（粘贴格式要能显示）。
 */
function normalizeLanguage(raw: unknown): SentenceLanguage | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  const structure = typeof o.structure === 'string' ? o.structure : ''
  const grammar = typeof o.grammar === 'string' ? o.grammar : ''
  const idioms = termsOf(o.idioms)
  const phrases = termsOf(o.phrases)
  const usage = termsOf(o.usage)
  if (!structure.trim() && !grammar.trim() && !idioms && !phrases && !usage) return null
  const out: SentenceLanguage = {}
  if (structure.trim()) out.structure = structure
  if (grammar.trim()) out.grammar = grammar
  if (idioms) out.idioms = idioms
  if (phrases) out.phrases = phrases
  if (usage) out.usage = usage
  if (o.source === 'ai' || o.source === 'manual') out.source = o.source
  if (typeof o.at === 'string' && o.at) out.at = o.at
  return out
}

/** 取该句所有语言点（兼容旧的单条 `language`；旧的按 AI 来源算；空对象不计）。 */
export function getSentenceLanguages(s: {
  language?: SentenceLanguage
  languages?: SentenceLanguage[]
} | null | undefined): SentenceLanguage[] {
  if (!s) return []
  const raw: unknown[] = s.languages?.length
    ? s.languages
    : s.language
      ? [{ ...s.language, source: s.language.source ?? 'ai' }]
      : []
  return raw.map(normalizeLanguage).filter((x): x is SentenceLanguage => !!x)
}

/** 该句是否有语言点（AI 或手动）。 */
export function hasSentenceLanguage(s: { language?: SentenceLanguage; languages?: SentenceLanguage[] } | null | undefined): boolean {
  return getSentenceLanguages(s).length > 0
}

// ── 手动编辑表单 ────────────────────────────────────────────────
// 阅读页与速读页共用同一个编辑器；表单的「怎么拆 / 怎么写回」只在这里实现一次。

/** 编辑器里的五个文本字段（与 `SentenceLanguage` 的文本字段一一对应）。 */
export interface LanguageForm {
  structure: string
  grammar: string
  idioms: string
  phrases: string
  usage: string
}

export const EMPTY_LANGUAGE_FORM: LanguageForm = {
  structure: '',
  grammar: '',
  idioms: '',
  phrases: '',
  usage: '',
}

/** 列表字段：支持「；/;/、/换行」分隔，去空、去重（换行也算分隔，多行输入不用手动写分号）。 */
export function splitLanguageList(s: string): string[] {
  return [...new Set(s.split(/[；;、\n]+/).map((x) => x.trim()).filter(Boolean))]
}

/**
 * 粘贴清洗：**只去掉空行，保留每行的行首缩进与单换行**。
 *
 * 语言点大多从网页 / AI 回答里复制，常见「一行正文一行空行」，保存后正文里
 * （`white-space: pre-wrap`）会把空行原样显示，行距被撑得很散；这里把空行吃掉。
 * 行首缩进是用户有意保留的层级信息（列表 / 代码块），**只清行尾空白，不动行首**。
 */
export function cleanPastedText(raw: string): string {
  return raw
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.replace(/[ \t]+$/, ''))
    .filter((line) => line.trim() !== '')
    .join('\n')
}

/** 表单 → 一条语言点；空字段不写，全空返回 `{}`（调用方据此判断「没内容」）。
 *  结构 / 语法保留原始换行与缩进，只把「全是空白」当没填。 */
export function languageFromForm(f: LanguageForm): SentenceLanguage {
  const o: SentenceLanguage = {}
  const structure = f.structure
  const grammar = f.grammar
  const idioms = splitLanguageList(f.idioms)
  const phrases = splitLanguageList(f.phrases)
  const usage = splitLanguageList(f.usage)
  if (structure.trim()) o.structure = structure
  if (grammar.trim()) o.grammar = grammar
  if (idioms.length) o.idioms = idioms
  if (phrases.length) o.phrases = phrases
  if (usage.length) o.usage = usage
  return o
}

/** 表单控件显示用：老数据即使是字符串 / 缺字段，也返回可编辑的文本。 */function formText(v: unknown): string {
  if (typeof v === 'string') return v
  if (Array.isArray(v)) {
    return v
      .filter((x): x is string => typeof x === 'string')
      .map((x) => x.trim())
      .filter(Boolean)
      .join('；')
  }
  return ''
}

/** 一条语言点 → 表单（列表用「；」连起来，编辑时仍可换成多行）。 */
export function languageToForm(L?: SentenceLanguage): LanguageForm {
  return {
    structure: formText(L?.structure),
    grammar: formText(L?.grammar),
    idioms: formText(L?.idioms),
    phrases: formText(L?.phrases),
    usage: formText(L?.usage),
  }
}

/** 列表里的一行摘要：结构/语法里的换行压成空格，避免把列表撑高。 */
export function languagePreview(L: SentenceLanguage): string {
  const oneLine = (s: unknown) => (typeof s === 'string' ? s : '').replace(/\s*\n+\s*/g, ' ').trim()
  return [
    oneLine(L.structure),
    oneLine(L.grammar),
    ...(termsOf(L.idioms) ?? []),
    ...(termsOf(L.phrases) ?? []),
    ...(termsOf(L.usage) ?? []),
  ]
    .filter(Boolean)
    .join(' ｜ ')
}

/** 出题提示词：按句 id 逐句分析，严格 JSON。 */
export function buildLanguagePrompt(sentences: { id: string; text: string }[]): string {
  const list = sentences.map((s) => `${s.id} | ${s.text}`).join('\n')
  return [
    '你是英语精读老师。请对下面每个句子做**语言点分析**，用于写作训练。',
    '',
    '每个句子输出一个对象，字段固定：',
    '- id：原样照抄句子编号；',
    '- structure：一句话点出句子主干与修饰结构（主句 + 从句/非谓语/插入语等）；',
    '- grammar：1–2 条最值得记的语法点（时态、语态、虚拟、倒装、比较……），只说句子真实用到的，不要泛泛而谈；',
    '- idioms：句中的习语（格式：**英文 — 简短中文**，如 take its toll — 造成损害；没有就给空数组）；',
    '- phrases：值得学的词组 / 搭配（格式：**英文 — 简短中文**，如 fall back on — 转而依靠；没有就给空数组）；',
    '- usage：这些词的用法要点（中文，简短，没有就给空数组）。',
    '',
    '要求：只分析真实出现、值得记的点；不要复述句意，不要翻译整句，不要编造。',
    '只输出一个 JSON 对象，格式：',
    '{"sentences":[{"id":"s001","structure":"...","grammar":"...","idioms":["take its toll — 造成损害"],"phrases":["fall back on — 转而依靠"],"usage":["..."]}]}',
    '不要输出其它任何文字。',
    '',
    '句子：',
    list,
  ].join('\n')
}

function asString(v: unknown): string {
  return typeof v === 'string' ? v.trim() : ''
}

function asStringArray(v: unknown): string[] | undefined {
  if (!Array.isArray(v)) return undefined
  const out = v.map(asString).filter(Boolean)
  return out.length ? out : undefined
}

function stripFence(raw: string): string {
  const m = raw.match(/```(?:json)?\s*([\s\S]*?)```/i)
  return (m ? m[1] : raw).trim()
}

/** 从一段文本里抠出第一个「配平的」JSON 对象（忽略前后废话/说明）。 */
function extractJsonObject(text: string): string | null {
  const start = text.indexOf('{')
  if (start < 0) return null
  let depth = 0
  let inStr = false
  let esc = false
  for (let i = start; i < text.length; i++) {
    const c = text[i]
    if (inStr) {
      if (esc) esc = false
      else if (c === '\\') esc = true
      else if (c === '"') inStr = false
    } else if (c === '"') {
      inStr = true
    } else if (c === '{') {
      depth++
    } else if (c === '}') {
      depth--
      if (depth === 0) return text.slice(start, i + 1)
    }
  }
  return null
}

/** 修掉 JSON 里非法的反斜杠转义（模型偶发把 [ ] 写成 \( \) 或 \[ \]）。 */
function sanitizeJson(s: string): string {
  return s
    .replace(/\\\(/g, '[')
    .replace(/\\\)/g, ']')
    .replace(/\\\[/g, '[')
    .replace(/\\\]/g, ']')
    .replace(/\\(?![\\"/bfnrtu])/g, '')
}

/** 从解析出的对象里抽出语言点行（每条至少要有 structure/grammar/idioms/phrases/usage 之一）。 */
function rowsFrom(parsed: unknown): LanguageRow[] {
  const list = Array.isArray(parsed)
    ? parsed
    : parsed && typeof parsed === 'object' && Array.isArray((parsed as { sentences?: unknown }).sentences)
      ? (parsed as { sentences: unknown[] }).sentences
      : []
  const out: LanguageRow[] = []
  for (const item of list) {
    if (!item || typeof item !== 'object') continue
    const o = item as Record<string, unknown>
    const id = asString(o.id ?? o.sentenceId)
    if (!id) continue
    const structure = asString(o.structure) || undefined
    const grammar = asString(o.grammar) || undefined
    const idioms = asStringArray(o.idioms)
    const phrases = asStringArray(o.phrases)
    const usage = asStringArray(o.usage)
    if (!structure && !grammar && !idioms && !phrases && !usage) continue
    out.push({ id, structure, grammar, idioms, phrases, usage })
  }
  return out
}

/**
 * 解析并校验语言点。宽容多种写法：代码围栏、前后夹说明、非法反斜杠转义。
 * 每条至少要有 structure/grammar/idioms/phrases/usage 之一，否则丢弃。
 */
export function parseLanguage(raw: string): LanguageRow[] {
  const text = stripFence(raw)
  if (!text) return []
  const balanced = extractJsonObject(text)
  const candidates = [text, balanced, sanitizeJson(text), balanced ? sanitizeJson(balanced) : null].filter(
    (c): c is string => !!c,
  )
  for (const c of candidates) {
    try {
      const rows = rowsFrom(JSON.parse(c))
      if (rows.length) return rows
    } catch {
      // 试下一个
    }
  }
  return []
}

/**
 * 把语言点写回句子（按 id 匹配）：**替换/AI 生成的那条，保留手动添加的若干条**。
 * 纯函数，方便单测；返回新的 sentences 数组。
 */
export function applyLanguage(sentences: Sentence[], rows: LanguageRow[], now: Date = new Date()): Sentence[] {
  if (!rows.length) return sentences
  const at = now.toISOString()
  const byId = new Map(rows.map((r) => [r.id, r]))
  return sentences.map((s) => {
    const r = byId.get(s.id)
    if (!r) return s
    const ai: SentenceLanguage = {
      structure: r.structure,
      grammar: r.grammar,
      idioms: r.idioms,
      phrases: r.phrases,
      usage: r.usage,
      source: 'ai',
      at,
    }
    const manual = getSentenceLanguages(s).filter((x) => x.source === 'manual')
    return { ...s, languages: [ai, ...manual], language: undefined }
  })
}
