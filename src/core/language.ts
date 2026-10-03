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

/** 解析并校验语言点；每条至少要有 structure/grammar/idioms/phrases/usage 之一。 */
export function parseLanguage(raw: string): LanguageRow[] {
  const text = stripFence(raw)
  if (!text) return []
  let obj: unknown
  try {
    obj = JSON.parse(text)
  } catch {
    return []
  }
  const list = Array.isArray(obj)
    ? obj
    : obj && typeof obj === 'object' && Array.isArray((obj as { sentences?: unknown }).sentences)
      ? (obj as { sentences: unknown[] }).sentences
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
 * 把语言点写回句子（按 id 匹配，覆盖旧的 language）。
 * 纯函数，方便单测；返回新的 sentences 数组。
 */
export function applyLanguage(sentences: Sentence[], rows: LanguageRow[]): Sentence[] {
  if (!rows.length) return sentences
  const byId = new Map(rows.map((r) => [r.id, r]))
  return sentences.map((s) => {
    const r = byId.get(s.id)
    if (!r) return s
    const language: SentenceLanguage = {
      structure: r.structure,
      grammar: r.grammar,
      idioms: r.idioms,
      phrases: r.phrases,
      usage: r.usage,
    }
    return { ...s, language }
  })
}
