import type { Sentence, VocabItem } from '../types/document'
import { poolFor, studyableItems } from './quizPool'
import {
  buildWritingFeedbackPrompt,
  parseWritingFeedbackDetailed,
  type ImitationTask,
  type WritingFeedback,
  type WritingFeedbackParse,
  type WritingIssue,
} from './writing'

/**
 * 「D老师奶牛工棚」：用已经学过的词 / 词组 / 习语做**主动产出**。
 *
 * 这一层只做纯函数：选目标块、拼 AI 提示词、解析 AI 结果、检查目标块有没有用上。
 * 不碰 React、不碰存储；会话编排在 `reader/hooks/useProductionSession`。
 */

export type ProductionScope = 'article' | 'all'
export type ProductionTargetKind = 'word' | 'phrase' | 'idiom'

export const PRODUCTION_TARGET_TYPES: readonly ProductionTargetKind[] = ['word', 'phrase', 'idiom']
export const PRODUCTION_SCOPES: readonly ProductionScope[] = ['article', 'all']
export const PRODUCTION_PROMPT_COUNTS = [3, 5, 8] as const
export const PRODUCTION_TARGETS_PER_PROMPT = [1, 2, 3] as const
export const PRODUCTION_WEAK_RATIOS = [0, 30, 50, 70] as const

export const PRODUCTION_ANGLE_LABEL = {
  daily: '日常生活',
  work: '工作沟通',
  opinion: '表达观点',
  story: '讲一件事',
  email: '邮件 / 消息',
} as const
export type ProductionAngle = keyof typeof PRODUCTION_ANGLE_LABEL

export const PRODUCTION_TONE_LABEL = {
  neutral: '中性',
  formal: '正式',
  casual: '口语',
} as const
export type ProductionTone = keyof typeof PRODUCTION_TONE_LABEL

export const PRODUCTION_ANGLES: readonly ProductionAngle[] = Object.keys(
  PRODUCTION_ANGLE_LABEL,
) as ProductionAngle[]
export const PRODUCTION_TONES: readonly ProductionTone[] = Object.keys(
  PRODUCTION_TONE_LABEL,
) as ProductionTone[]

export interface ProductionTarget {
  /** 稳定 id：词条 id + 类型 + 来源下标；AI 只许从这份清单里选 */
  id: string
  itemId: string
  kind: ProductionTargetKind
  text: string
  meaning: string
}

export interface ProductionPrompt {
  id: string
  /** 中文情境提示；出题时绝不把英文目标块写进这里 */
  zh: string
  goal: string
  targets: ProductionTarget[]
}

export interface ProductionTargetHit {
  id: string
  kind: ProductionTargetKind
  text: string
  meaning: string
  used: boolean
}

export interface ProductionSettings {
  topic: string
  angle: ProductionAngle
  tone: ProductionTone
  scope: ProductionScope
  types: ProductionTargetKind[]
  promptCount: number
  targetsPerPrompt: number
  weakRatio: number
}

export const DEFAULT_PRODUCTION_SETTINGS: ProductionSettings = {
  topic: '',
  angle: 'daily',
  tone: 'neutral',
  scope: 'article',
  types: [...PRODUCTION_TARGET_TYPES],
  promptCount: 5,
  targetsPerPrompt: 2,
  weakRatio: 30,
}

/** 外部输入（localStorage / 旧备份）守卫：坏字段逐项回默认，不炸整页。 */
export function normalizeProductionSettings(raw: unknown): ProductionSettings {
  const out = { ...DEFAULT_PRODUCTION_SETTINGS, types: [...DEFAULT_PRODUCTION_SETTINGS.types] }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out
  const o = raw as Record<string, unknown>
  if (typeof o.topic === 'string') out.topic = o.topic.trim().slice(0, 200)
  if (typeof o.angle === 'string' && (PRODUCTION_ANGLES as string[]).includes(o.angle)) {
    out.angle = o.angle as ProductionAngle
  }
  if (typeof o.tone === 'string' && (PRODUCTION_TONES as string[]).includes(o.tone)) {
    out.tone = o.tone as ProductionTone
  }
  if (o.scope === 'article' || o.scope === 'all') out.scope = o.scope
  if (Array.isArray(o.types)) {
    const types = [...new Set(o.types.filter((t): t is ProductionTargetKind =>
      typeof t === 'string' && (PRODUCTION_TARGET_TYPES as string[]).includes(t),
    ))]
    if (types.length) out.types = types
  }
  if (typeof o.promptCount === 'number' && (PRODUCTION_PROMPT_COUNTS as readonly number[]).includes(o.promptCount)) {
    out.promptCount = o.promptCount
  }
  if (
    typeof o.targetsPerPrompt === 'number' &&
    (PRODUCTION_TARGETS_PER_PROMPT as readonly number[]).includes(o.targetsPerPrompt)
  ) {
    out.targetsPerPrompt = o.targetsPerPrompt
  }
  if (typeof o.weakRatio === 'number' && (PRODUCTION_WEAK_RATIOS as readonly number[]).includes(o.weakRatio)) {
    out.weakRatio = o.weakRatio
  }
  return out
}

export interface BuildProductionTargetsOptions {
  items: VocabItem[]
  scope: ProductionScope
  articleIdentity: string
  docLemmas: ReadonlySet<string>
  types: readonly ProductionTargetKind[]
  /** 最多取多少个目标块（题数 × 每题目标数） */
  limit: number
  weakRatio: number
  rng?: () => number
}

export interface ProductionTargetPool {
  targets: ProductionTarget[]
  /** 过滤后一共有多少候选（用于「不够」提示） */
  total: number
  weak: number
}

function shuffle<T>(arr: readonly T[], rng: () => number): T[] {
  const out = [...arr]
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}

/** `run out — 用完` / `run out | 用完` → 英文 / 中文；没有分隔就整段当英文。 */
function splitChunk(text: string): { text: string; meaning: string } {
  const raw = text.trim()
  const parts = raw.split(/\s+[—–|]\s+|\s+\|\s+/)
  return { text: (parts[0] ?? raw).trim(), meaning: (parts[1] ?? '').trim() }
}

function isWeakItem(item: VocabItem): boolean {
  return (item.reviewState.lapses ?? 0) > 0 || item.reviewState.repetitions < 2
}

function targetsOfItem(item: VocabItem, types: ReadonlySet<ProductionTargetKind>): ProductionTarget[] {
  const out: ProductionTarget[] = []
  const kind = item.kind ?? 'word'
  if (kind === 'word' || kind === 'phrase' || kind === 'idiom') {
    if (types.has(kind)) {
      out.push({
        id: `${item.id}|self|${kind}`,
        itemId: item.id,
        kind,
        text: item.word.trim(),
        meaning: item.meaning?.trim() ?? '',
      })
    }
  }
  if (types.has('phrase') && kind === 'word') {
    for (const [i, raw] of (item.phrases ?? []).entries()) {
      const c = splitChunk(raw)
      if (c.text) out.push({ id: `${item.id}|phrase|${i}`, itemId: item.id, kind: 'phrase', ...c })
    }
  }
  if (types.has('idiom') && kind === 'word') {
    for (const [i, raw] of (item.idioms ?? []).entries()) {
      const c = splitChunk(raw)
      if (c.text) out.push({ id: `${item.id}|idiom|${i}`, itemId: item.id, kind: 'idiom', ...c })
    }
  }
  return out
}

/**
 * 选本轮目标块：范围 → 类型 → 去重 → 按「薄弱比例」抽。
 *
 * 这里不安排“每个 prompt 用哪几个”，那是 AI 出题后由 prompt.targetIds 决定的；
 * 这里只保证给 AI 一张可用的候选清单。
 */
export function buildProductionTargets(opts: BuildProductionTargetsOptions): ProductionTargetPool {
  const limit = Math.max(1, Math.floor(opts.limit))
  const types = new Set(opts.types)
  if (!types.size) return { targets: [], total: 0, weak: 0 }
  const scopePool = poolFor(studyableItems(opts.items), opts.scope, {
    articleIdentity: opts.articleIdentity,
    docLemmas: new Set(opts.docLemmas),
  })
  const byItem = new Map(scopePool.map((it) => [it.id, it]))
  const seen = new Set<string>()
  const all: ProductionTarget[] = []
  for (const item of scopePool) {
    for (const t of targetsOfItem(item, types)) {
      const key = `${t.kind}:${t.text.toLowerCase()}`
      if (!t.text || seen.has(key)) continue
      seen.add(key)
      all.push(t)
    }
  }
  if (!all.length) return { targets: [], total: 0, weak: 0 }

  const rng = opts.rng ?? Math.random
  const weak: ProductionTarget[] = []
  const strong: ProductionTarget[] = []
  for (const t of all) {
    const item = byItem.get(t.itemId)
    if (item && isWeakItem(item)) weak.push(t)
    else strong.push(t)
  }
  const weakTake = Math.min(weak.length, Math.round((limit * Math.max(0, Math.min(100, opts.weakRatio))) / 100))
  const picked = [
    ...shuffle(weak, rng).slice(0, weakTake),
    ...shuffle(strong, rng).slice(0, Math.max(0, limit - weakTake)),
  ]
  if (picked.length < limit) {
    const pickedIds = new Set(picked.map((t) => t.id))
    const rest = shuffle(all.filter((t) => !pickedIds.has(t.id)), rng)
    picked.push(...rest.slice(0, limit - picked.length))
  }
  return { targets: shuffle(picked, rng), total: all.length, weak: weak.length }
}

export interface BuildProductionPackInput {
  topic: string
  angle: ProductionAngle
  tone: ProductionTone
  articleTitle: string
  targets: readonly ProductionTarget[]
  promptCount: number
  targetsPerPrompt: number
}

/** 让 AI 从**给定候选清单**里选目标块并出中文情境题。 */
export function buildProductionPackPrompt(input: BuildProductionPackInput): string {
  const targetLines = input.targets
    .map((t) => `- ${t.id} | ${t.kind} | ${t.text}${t.meaning ? ` | ${t.meaning}` : ''}`)
    .join('\n')
  return [
    '你是英语产出训练的出题老师。请根据主题，写中文情境提示，让学生用英文表达。',
    '',
    `主题：${input.topic}`,
    `角度：${PRODUCTION_ANGLE_LABEL[input.angle]}`,
    `语气：${PRODUCTION_TONE_LABEL[input.tone]}`,
    input.articleTitle ? `参考文章：${input.articleTitle}` : '',
    '',
    '必须遵守：',
    `- 出 ${input.promptCount} 道题；每道题必须分配 ${input.targetsPerPrompt} 个目标块；`,
    '- 只能从下面候选清单里选 targetIds，不能编造；目标块不重复使用；',
    '- zh 必须是自然的中文情境 / 沟通目标，不能出现英文目标词，不能逐字提示英文句式；',
    '- goal 用中文说明这句话要达成什么（如「委婉拒绝」「说明进度」「表达不同意见」）；',
    '- 题目之间尽量覆盖不同情境，不要 5 道题都在说同一件事；',
    '- 只输出 JSON，不要 Markdown、不要解释。',
    '',
    '候选目标块（id | 类型 | 英文 | 中文）：',
    targetLines,
    '',
    '输出格式：',
    '{"prompts":[{"zh":"中文情境","goal":"中文沟通目标","targetIds":["id1","id2"]}]}',
  ]
    .filter(Boolean)
    .join('\n')
}

function stripFence(raw: string): string {
  const m = raw.match(/```(?:json)?\s*([\s\S]*?)```/i)
  return (m ? m[1] : raw).trim()
}

function asString(v: unknown, max: number): string {
  return typeof v === 'string' ? v.trim().slice(0, max) : ''
}

/**
 * 解析 AI 题目包。只认候选清单里的目标 id；坏题 / 无目标 / 中文为空直接丢。
 */
export function parseProductionPack(
  raw: string,
  allowed: readonly ProductionTarget[],
  maxPrompts = 12,
): ProductionPrompt[] | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(stripFence(raw))
  } catch {
    return null
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
  const promptsRaw = (parsed as Record<string, unknown>).prompts
  if (!Array.isArray(promptsRaw)) return null
  const byId = new Map(allowed.map((t) => [t.id, t]))
  const prompts: ProductionPrompt[] = []
  for (const [i, item] of promptsRaw.entries()) {
    if (i >= maxPrompts) break
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue
    const o = item as Record<string, unknown>
    const zh = asString(o.zh, 600)
    if (!zh) continue
    const ids = Array.isArray(o.targetIds) ? o.targetIds.filter((x): x is string => typeof x === 'string') : []
    const targets: ProductionTarget[] = []
    const seen = new Set<string>()
    for (const id of ids) {
      const target = byId.get(id)
      if (!target || seen.has(target.id)) continue
      seen.add(target.id)
      targets.push(target)
    }
    if (!targets.length) continue
    prompts.push({
      id: `prod-${i + 1}`,
      zh,
      goal: asString(o.goal, 300),
      targets,
    })
  }
  return prompts.length ? prompts : null
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function normalizeText(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFKC')
    .replace(/[’‘]/g, "'")
    .replace(/\s+/g, ' ')
    .trim()
}

/** 目标块是否出现在作答里：单词允许常见词形后缀，词组按连续文本匹配。 */
export function targetUsed(answer: string, target: ProductionTarget): boolean {
  const hay = normalizeText(answer)
  const needle = normalizeText(target.text)
  if (!needle) return false
  if (target.kind !== 'word') return hay.includes(needle)
  const last = needle.slice(-1)
  const forms = [
    needle,
    `${needle}s`,
    `${needle}es`,
    `${needle}d`,
    `${needle}ed`,
    `${needle}ing`,
    `${needle}er`,
    `${needle}est`,
    `${needle}ly`,
    // run → running / rub → rubbing 这类双写辅音
    `${needle}${last}ing`,
    `${needle}${last}ed`,
  ]
  const re = new RegExp(`\\b(?:${forms.map(escapeRegExp).join('|')})\\b`, 'i')
  return re.test(hay)
}

export function checkProductionTargets(answer: string, targets: readonly ProductionTarget[]): ProductionTargetHit[] {
  return targets.map((t) => ({
    id: t.id,
    kind: t.kind,
    text: t.text,
    meaning: t.meaning,
    used: targetUsed(answer, t),
  }))
}

export interface ProductionTask extends ImitationTask {
  kind: 'production'
  topic: string
  goal: string
  promptId: string
  targets: ProductionTarget[]
  hits?: ProductionTargetHit[]
}

/** 出评分任务：复用仿写批改的 rubric / mustUse / focus 口径。 */
export function makeProductionTask(prompt: ProductionPrompt, topic: string): ProductionTask {
  return {
    kind: 'production',
    task: prompt.zh,
    model: '（自由表达，没有唯一范句）',
    goal: prompt.goal,
    promptId: prompt.id,
    topic,
    targets: prompt.targets,
    mustUse: prompt.targets.map((t) => t.text),
    rubric: [
      { dimension: '意思到位', weight: 40, description: '中文情境想表达的意思是否完整、准确' },
      { dimension: '目标词块', weight: 30, description: '目标词 / 词组 / 习语是否用上且搭配正确' },
      { dimension: '语法与自然度', weight: 30, description: '语法、时态、冠词、介词和语序是否自然' },
    ],
    focus: prompt.targets.map((t) => t.text).join(' / '),
  }
}

export function buildProductionFeedbackPrompt(
  task: ProductionTask,
  answer: string,
  previousIssues?: readonly Pick<WritingIssue, 'original' | 'suggestion' | 'reason' | 'rule' | 'key'>[],
): string {
  return buildWritingFeedbackPrompt(task, answer, previousIssues ? { previousIssues } : {})
}

export function parseProductionFeedback(raw: string, answer: string): WritingFeedbackParse | null {
  return parseWritingFeedbackDetailed(raw, { answer })
}

/** 历史记录里把 production 任务认出来；坏形状返回 false，不让历史页炸。 */
export function isProductionTask(task: unknown): task is ProductionTask {
  if (!task || typeof task !== 'object' || Array.isArray(task)) return false
  const o = task as Record<string, unknown>
  return (
    o.kind === 'production' &&
    typeof o.topic === 'string' &&
    typeof o.promptId === 'string' &&
    Array.isArray(o.targets)
  )
}

/** 一条判过分的 production 反馈里，目标块命中情况。 */
export function productionHits(task: unknown): ProductionTargetHit[] {
  if (!isProductionTask(task) || !Array.isArray(task.hits)) return []
  return task.hits.filter(
    (h): h is ProductionTargetHit =>
      !!h &&
      typeof h === 'object' &&
      typeof (h as ProductionTargetHit).id === 'string' &&
      typeof (h as ProductionTargetHit).text === 'string' &&
      typeof (h as ProductionTargetHit).used === 'boolean',
  )
}

/** 只用于 UI 摘要：目标块命中数。 */
export function countProductionHits(hits: readonly ProductionTargetHit[]): number {
  return hits.filter((h) => h.used).length
}

/** 供文档 / 测试复用：`WritingFeedback` 的空值判断不在这里另写一套。 */
export type ProductionFeedback = WritingFeedback

/** 目标块范围要用的文章词集合（正文词 + 语言点词）。 */
export function productionDocLemmas(sentences: readonly Sentence[] | null | undefined): Set<string> {
  const out = new Set<string>()
  for (const s of sentences ?? []) {
    for (const w of s.vocab) out.add(w.toLowerCase())
    for (const l of s.languages ?? []) {
      for (const k of l.phrases ?? []) out.add(k.toLowerCase())
      for (const k of l.idioms ?? []) out.add(k.toLowerCase())
    }
  }
  return out
}
