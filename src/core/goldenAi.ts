import {
  GOLDEN_TARGET_LIMIT,
  buildLocalGoldenSentence,
  dedupeGoldenLesson,
  normalizeGoldenTargets,
} from './golden'
import { normalizeGoldenLesson } from './goldenParse'
import type { GoldenLesson, GoldenSentence, Sentence } from '../types/document'

/**
 * 「D老师小课堂」的 AI 任务：一次生成「主旨 + 脉络 + 金句 + 句型/时态 + 词块」。
 *
 * 边界：
 *   - 提示词只要求 AI 挑句子、加注释；**不要求它改写原句**；
 *   - 解析层用 `normalizeGoldenLesson` 校验句子 id 与目标是否逐字出现；
 *   - AI 缺的句子/目标由本地推导补齐（`mergeGoldenLessons`），所以 AI 失败也能练。
 */

export const GOLDEN_AI_MAX_SENTENCES = 12

export interface GoldenPromptSentence {
  id: string
  text: string
  translation?: string | null
  paraId?: string
}

export interface GoldenPromptInput {
  title?: string
  sentences: GoldenPromptSentence[]
  /** 让 AI 挑几句；默认 10，最多 12。 */
  maxSentences?: number
}

/** 网页版 / 本机 agent 共用的一份提示词。 */
export function buildGoldenPrompt(input: GoldenPromptInput): string {
  const max = Math.max(1, Math.min(GOLDEN_AI_MAX_SENTENCES, input.maxSentences ?? 10))
  const lines = input.sentences.map((s) => {
    const tr = s.translation?.trim() ? `\t译：${s.translation.trim()}` : ''
    return `${s.id}\t${s.text}${tr}`
  })
  return [
    '你是英语写作教练。请从下面这篇文章里挑出最值得「仿写迁移」的句子，做成一套金句精练。',
    '',
    '挑选标准（按优先级）：',
    '1. 有值得学的句型 / 结构（如 in response to + n., … has become …）；',
    '2. 有时态 / 语态重点（现在完成、被动、虚拟、倒装等）；',
    '3. 有可迁移的搭配 / 习语；',
    '4. 句子长度适中（8–40 词），不要挑太短的口水句。',
    `最多挑 ${max} 句；宁可少挑，也不要凑数。`,
    '',
    '对每一句输出：',
    '- id：原样照抄句子编号；',
    '- zh：整句中文（有现成译文就用它，不要改写意思）；',
    '- pattern：一句话点出值得迁移的句型；',
    '- tense：时态 / 语态重点（只写句子真实用到的）；',
    '- note：用法提醒；本句所有无法逐字挖空的语法/用法都可以放这里，不要省略；',
    '- targets：尽量覆盖本句所有可迁移语言点（phrases / idioms / collocations / words），按在句中出现的先后排列；通常 3–12 个，最多 ' + GOLDEN_TARGET_LIMIT + ' 个（短句少、长句最多 20，程序会按句长再截断），不要只挑 3–6 个。每项：',
    '  - en：**必须是原句里逐字出现的连续片段**，不要改写、不要补标点；',
    '  - zh：简短中文提示（填空时给用户看）；',
    '  - kind：只能是 pattern / tense / collocation / idiom / usage / word 之一。',
    '',
    '另外输出：',
    '- summary：2–3 句中文概括文章核心；',
    '- outline：按段落给 { paraId, role, points }，role 只能是 intro / body / conclusion，points 是 1–2 条中文要点；',
    '- selected：你挑中的句子 id 数组，和 sentences 里的 id 一致。',
    '',
    '硬规则：',
    '- 只从给定句子里挑，不要编造句子；',
    '- targets.en 必须是原句的逐字片段；语法/结构/用法不是逐字片段的，放 pattern / tense / note，不要硬造成 target；',
    '- 不要输出 Markdown、不要解释，只输出一个 JSON 对象。',
    '',
    '输出格式：',
    '{"summary":"...","outline":[{"paraId":"p01","role":"intro","points":["..."]}],"selected":["s001"],"sentences":[{"id":"s001","zh":"...","pattern":"...","tense":"...","note":"...","targets":[{"en":"in response to","zh":"为了应对","kind":"collocation"}]}]}',
    '',
    input.title ? `文章标题：${input.title}` : '',
    '句子（id\t原文\t译文）：',
    ...lines,
  ]
    .filter(Boolean)
    .join('\n')
}

function stripFence(raw: string): string {
  const m = raw.match(/```(?:json)?\s*([\s\S]*?)```/i)
  return (m ? m[1] : raw).trim()
}

/** 从一段文本里抠出第一个配平的 JSON 对象（忽略前后解释）。 */
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
    } else if (c === '"') inStr = true
    else if (c === '{') depth++
    else if (c === '}') {
      depth--
      if (depth === 0) return text.slice(start, i + 1)
    }
  }
  return null
}

function sanitizeJson(s: string): string {
  return s
    .replace(/\\\(/g, '[')
    .replace(/\\\)/g, ']')
    .replace(/\\\[/g, '[')
    .replace(/\\\]/g, ']')
    .replace(/\\(?![\\"/bfnrtu])/g, '')
}

/** 解析 AI 金句课；宽容围栏/前后废话/非法转义，但内容仍要过 `normalizeGoldenLesson`。 */
export function parseGoldenLesson(
  raw: string,
  sentences: { id: string; text: string; translation?: string | null }[],
): GoldenLesson | null {
  const text = stripFence(raw)
  if (!text) return null
  const balanced = extractJsonObject(text)
  const candidates = [text, balanced, sanitizeJson(text), balanced ? sanitizeJson(balanced) : null].filter(
    (x): x is string => !!x,
  )
  for (const c of candidates) {
    try {
      const parsed: unknown = JSON.parse(c)
      const lesson = normalizeGoldenLesson(parsed, sentences)
      if (lesson) return { ...lesson, source: 'ai', updatedAt: new Date().toISOString() }
    } catch {
      // 试下一个
    }
  }
  return null
}

export interface MergeGoldenOptions {
  /** 用户的本课设置（去重）优先于 AI 返回。 */
  dedupe?: boolean
  /** 首次 AI 生成时用 AI 挑的金句；用户手动改过选择后默认保留本地。 */
  preferAI?: boolean
  /** 填空单位；用户本课设置优先。 */
  blankUnit?: 'word' | 'target'
  /** 整句渐进开关；用户本课设置优先。 */
  sentenceFill?: boolean
}

/**
 * AI 与本地合并：AI 有的用 AI，AI 缺的用本地；保证每句至少有内容可练。
 * 用户手动选的金句（`local.selected` 和 AI 不同）默认保留本地选择，除非调用方显式用 AI 的。
 */
export function mergeGoldenLessons(
  local: GoldenLesson,
  ai: GoldenLesson,
  sentences: Sentence[],
  opts: MergeGoldenOptions = {},
): GoldenLesson {
  const byId = new Map(sentences.map((s) => [s.id, s]))
  const localContent = new Map(local.sentences.map((s) => [s.id, s]))
  const aiContent = new Map(ai.sentences.map((s) => [s.id, s]))
  const ids = [...new Set([...ai.sentences.map((s) => s.id), ...local.sentences.map((s) => s.id)])]
  const merged: GoldenSentence[] = []
  for (const id of ids) {
    const sentence = byId.get(id)
    if (!sentence) continue
    const a = aiContent.get(id)
    const l = localContent.get(id) ?? buildLocalGoldenSentence(sentence)
    // AI 注释优先，但本地语言点不能被覆盖：两边取并集后再按原句重排/去重。
    const targets = normalizeGoldenTargets(sentence.text, [...(a?.targets ?? []), ...l.targets])
    if (!a && !l) continue
    merged.push({
      id,
      ...(a?.zh || l.zh ? { zh: a?.zh || l.zh } : {}),
      ...(a?.pattern || l.pattern ? { pattern: a?.pattern || l.pattern } : {}),
      ...(a?.tense || l.tense ? { tense: a?.tense || l.tense } : {}),
      ...(a?.note || l.note ? { note: a?.note || l.note } : {}),
      targets,
    })
  }
  const valid = new Set(merged.map((s) => s.id))
  const preferred = opts.preferAI ? ai.selected : local.selected.length ? local.selected : ai.selected
  const selected = preferred.filter((id) => valid.has(id))
  const exam = ai.exam?.length ? ai.exam : local.exam
  const lesson: GoldenLesson = {
    version: 1,
    source: 'merged',
    ...(ai.summary || local.summary ? { summary: ai.summary || local.summary } : {}),
    outline: ai.outline.length ? ai.outline : local.outline,
    sentences: merged,
    selected: selected.length ? selected : merged.map((s) => s.id),
    aiSelected: ai.selected.filter((id) => valid.has(id)),
    ...(exam?.length ? { exam } : {}),
    options: {
      dedupe: opts.dedupe ?? local.options?.dedupe ?? false,
      pick: opts.preferAI ? 'ai' : local.options?.pick ?? 'manual',
      blankUnit: opts.blankUnit ?? local.options?.blankUnit ?? 'word',
      sentenceFill: opts.sentenceFill ?? local.options?.sentenceFill ?? true,
      ...(local.options?.examAfter ? { examAfter: local.options.examAfter } : {}),
    },
    updatedAt: new Date().toISOString(),
  }
  return lesson.options?.dedupe ? dedupeGoldenLesson(lesson) : lesson
}
