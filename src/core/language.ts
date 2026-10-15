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

/** 语言点里是否真有内容（空对象 `{}` 视为没有）。 */
function hasLangContent(L: SentenceLanguage): boolean {
  return !!(L.structure || L.grammar || L.idioms?.length || L.phrases?.length || L.usage?.length)
}

/** 取该句所有语言点（兼容旧的单条 `language`；旧的按 AI 来源算；空对象不计）。 */
export function getSentenceLanguages(s: {
  language?: SentenceLanguage
  languages?: SentenceLanguage[]
} | null | undefined): SentenceLanguage[] {
  if (!s) return []
  const list = s.languages?.length
    ? s.languages
    : s.language
      ? [{ ...s.language, source: s.language.source ?? 'ai' }]
      : []
  return list.filter(hasLangContent)
}

/** 该句是否有语言点（AI 或手动）。 */
export function hasSentenceLanguage(s: { language?: SentenceLanguage; languages?: SentenceLanguage[] } | null | undefined): boolean {
  return getSentenceLanguages(s).length > 0
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
    '- idioms：句中的习语（英文原形，没有就给空数组）；',
    '- phrases：值得学的词组 / 搭配（英文原形，没有就给空数组）；',
    '- usage：这些词的用法要点（中文，简短，没有就给空数组）。',
    '',
    '要求：只分析真实出现、值得记的点；不要复述句意，不要翻译，不要编造。',
    '只输出一个 JSON 对象，格式：',
    '{"sentences":[{"id":"s001","structure":"...","grammar":"...","idioms":["..."],"phrases":["..."],"usage":["..."]}]}',
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
