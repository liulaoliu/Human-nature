import type { Sentence, VocabItem } from '../types/document'
import { poolFor, studyableItems } from './quizPool'

/**
 * 「D老师奶牛工棚」：用已经学过的词 / 词组 / 习语做**主动产出**。
 *
 * 这一层只做纯函数：选目标块、拼 AI 提示词、解析 AI 结果、检查目标块有没有用上。
 * 不碰 React、不碰存储；会话编排在 `reader/hooks/useProductionSession`。
 */

export type ProductionScope = 'article' | 'all' | 'recent' | 'weak' | 'due' | 'mistakes' | 'theme'
export type ProductionTargetKind = 'word' | 'phrase' | 'idiom'
/**
 * 三种吃法：
 * - full（全脂）：不设主题，按配置随机抽词块，AI 随机出情境；
 * - skim（脱脂奶）：围绕一个主题出情境，同样要求用上目标块；
 * - yogurt（风味酸奶）：用户粘贴中英对照，按句拆开逐句翻译。
 */
export type ProductionMode = 'full' | 'skim' | 'yogurt'
export type ProductionDirection = 'zh-en' | 'en-zh'
export type YogurtSplitMode = 'sentence' | 'line'
export type ProductionLevel = 'b1' | 'b2' | 'c1'
export type ProductionVariant = 'translate' | 'cloze' | 'reorder'
export const PRODUCTION_VARIANT_LABEL: Record<ProductionVariant, string> = {
  translate: '给中文写英文',
  cloze: '参考句挖空',
  reorder: '参考句词序打乱',
}
export const PRODUCTION_VARIANTS: readonly ProductionVariant[] = ['translate', 'cloze', 'reorder']
export const PRODUCTION_LEVEL_LABEL: Record<ProductionLevel, string> = {
  b1: 'B1 基础',
  b2: 'B2 中阶',
  c1: 'C1 进阶',
}
export const PRODUCTION_LEVELS: readonly ProductionLevel[] = ['b1', 'b2', 'c1']

export const PRODUCTION_MODES: readonly ProductionMode[] = ['full', 'skim', 'yogurt']
export const PRODUCTION_MODE_LABEL: Record<ProductionMode, string> = {
  full: '全脂',
  skim: '脱脂奶',
  yogurt: '风味酸奶',
}
export const PRODUCTION_MODE_DESC: Record<ProductionMode, string> = {
  full: '不写主题；AI 随机定主题，可选从本机词库抽词 / 词组。',
  skim: '先写主题；可选带上本机词 / 词组 / 习语，不选就纯主题出句。',
  yogurt: '粘贴中文原文和英文参考译文；按句拆开，逐句翻译，批改后再重写。',
}

export const PRODUCTION_TARGET_TYPES: readonly ProductionTargetKind[] = ['word', 'phrase', 'idiom']
export const PRODUCTION_SCOPES: readonly ProductionScope[] = [
  'article',
  'all',
  'recent',
  'weak',
  'due',
  'mistakes',
  'theme',
]
export const PRODUCTION_SCOPE_LABEL: Record<ProductionScope, string> = {
  article: '本篇（有上下文）',
  all: '全库（练迁移）',
  recent: '最近练过',
  weak: '薄弱',
  due: '到期',
  mistakes: '用错过',
  theme: '匹配主题',
}
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
  /** 风味酸奶：这一句的参考译文（答完 / 批改后才给用户看） */
  reference?: string
  /** 风味酸奶方向：默认中→英；英→中时参考答案是中文。 */
  answerLang?: 'en' | 'zh'
  /** 目标块题的参考英文句；默认隐藏，只在挖空 / 排序题型里作为提示。 */
  model?: string
}

export interface ProductionTargetHit {
  id: string
  kind: ProductionTargetKind
  text: string
  meaning: string
  used: boolean
}

export interface ProductionSettings {
  mode: ProductionMode
  topic: string
  angle: ProductionAngle
  tone: ProductionTone
  level: ProductionLevel
  variant: ProductionVariant
  scope: ProductionScope
  types: ProductionTargetKind[]
  promptCount: number
  targetsPerPrompt: number
  weakRatio: number
  /** 全脂是否带本机词块；关掉就是纯随机主题。 */
  fullUseChunks: boolean
  /** 脱脂奶是否带本机词块；默认关，选中后和全脂一样用目标块硬校验。 */
  skimUseChunks: boolean
  /** 风味酸奶草稿：原文 / 参考译文。体量不大，跟设置一起留在本机。 */
  sourceText: string
  referenceText: string
  /** 风味酸奶方向与拆句方式。 */
  yogurtDirection: ProductionDirection
  yogurtSplit: YogurtSplitMode
  /** 逐句结束后再加一道整段连写。 */
  yogurtParagraph: boolean
}

export const DEFAULT_PRODUCTION_SETTINGS: ProductionSettings = {
  mode: 'full',
  topic: '',
  angle: 'daily',
  tone: 'neutral',
  level: 'b2',
  variant: 'translate',
  scope: 'article',
  types: [...PRODUCTION_TARGET_TYPES],
  promptCount: 5,
  targetsPerPrompt: 2,
  weakRatio: 30,
  fullUseChunks: true,
  skimUseChunks: false,
  sourceText: '',
  referenceText: '',
  yogurtDirection: 'zh-en',
  yogurtSplit: 'sentence',
  yogurtParagraph: true,
}

/** 外部输入（localStorage / 旧备份）守卫：坏字段逐项回默认，不炸整页。 */
export function normalizeProductionSettings(raw: unknown): ProductionSettings {
  const out = { ...DEFAULT_PRODUCTION_SETTINGS, types: [...DEFAULT_PRODUCTION_SETTINGS.types] }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out
  const o = raw as Record<string, unknown>
  if (typeof o.mode === 'string' && (PRODUCTION_MODES as string[]).includes(o.mode)) {
    out.mode = o.mode as ProductionMode
  }
  if (typeof o.topic === 'string') out.topic = o.topic.trim().slice(0, 200)
  if (typeof o.sourceText === 'string') out.sourceText = o.sourceText.slice(0, 50000)
  if (typeof o.referenceText === 'string') out.referenceText = o.referenceText.slice(0, 50000)
  if (o.yogurtDirection === 'zh-en' || o.yogurtDirection === 'en-zh') out.yogurtDirection = o.yogurtDirection
  if (o.yogurtSplit === 'sentence' || o.yogurtSplit === 'line') out.yogurtSplit = o.yogurtSplit
  if (typeof o.yogurtParagraph === 'boolean') out.yogurtParagraph = o.yogurtParagraph
  if (typeof o.fullUseChunks === 'boolean') out.fullUseChunks = o.fullUseChunks
  if (typeof o.skimUseChunks === 'boolean') out.skimUseChunks = o.skimUseChunks
  if (typeof o.angle === 'string' && (PRODUCTION_ANGLES as string[]).includes(o.angle)) {
    out.angle = o.angle as ProductionAngle
  }
  if (typeof o.tone === 'string' && (PRODUCTION_TONES as string[]).includes(o.tone)) {
    out.tone = o.tone as ProductionTone
  }
  if (typeof o.level === 'string' && (PRODUCTION_LEVELS as string[]).includes(o.level)) {
    out.level = o.level as ProductionLevel
  }
  if (typeof o.variant === 'string' && (PRODUCTION_VARIANTS as string[]).includes(o.variant)) {
    out.variant = o.variant as ProductionVariant
  }
  if (typeof o.scope === 'string' && (PRODUCTION_SCOPES as string[]).includes(o.scope)) {
    out.scope = o.scope as ProductionScope
  }
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

/** 进度视图的最小形状；由 `productionHistory` 从 attempts 现算。 */
export interface ProductionProgressLike {
  key: string
  kind: ProductionTargetKind
  text: string
  attempts: number
  hits: number
  misses: number
  dueAt: string
  lastAt: string
}

/** 一天从「到期」范围最多抽几个目标块，避免一次清几百个。 */
export const PRODUCTION_DUE_DAILY_CAP = 6

/** 全库候选目标块（去重、按类型过滤）；用于「到期 / 新目标」提醒口径。 */
export function productionTargetCandidates(
  items: VocabItem[],
  types: readonly ProductionTargetKind[],
): ProductionTarget[] {
  const typeSet = new Set(types)
  if (!typeSet.size) return []
  const seen = new Set<string>()
  const out: ProductionTarget[] = []
  for (const item of studyableItems(items)) {
    for (const target of targetsOfItem(item, typeSet)) {
      const key = `${target.kind}:${target.text.trim().toLowerCase().replace(/\s+/g, ' ')}`
      if (!target.text || seen.has(key)) continue
      seen.add(key)
      out.push(target)
    }
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
  /** 当前主题；`scope='theme'` 时按 text/meaning 匹配。 */
  theme?: string
  /** 从历史 attempts 现算的目标块进度；没有进度 = 新目标。 */
  progress?: readonly ProductionProgressLike[]
  nowIso?: string
  rng?: () => number
}

export interface ProductionTargetPool {
  targets: ProductionTarget[]
  /** 过滤后一共有多少候选（用于「不够」提示） */
  total: number
  weak: number
  /** 过滤范围没有匹配时回退全库的提示 */
  note?: string
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
  // 进度范围仍从全库候选里筛；文章范围只影响候选池。
  const baseScope = opts.scope === 'article' ? 'article' : 'all'
  const scopePool = poolFor(studyableItems(opts.items), baseScope, {
    articleIdentity: opts.articleIdentity,
    docLemmas: new Set(opts.docLemmas),
  })
  const byItem = new Map(scopePool.map((it) => [it.id, it]))
  const seen = new Set<string>()
  const allRaw: ProductionTarget[] = []
  for (const item of scopePool) {
    for (const t of targetsOfItem(item, types)) {
      const key = `${t.kind}:${t.text.trim().toLowerCase().replace(/\s+/g, ' ')}`
      if (!t.text || seen.has(key)) continue
      seen.add(key)
      allRaw.push(t)
    }
  }
  if (!allRaw.length) return { targets: [], total: 0, weak: 0 }

  const progress = new Map((opts.progress ?? []).map((p) => [p.key, p]))
  const nowIso = opts.nowIso ?? new Date().toISOString()
  const now = Date.parse(nowIso)
  const targetKey = (t: ProductionTarget) => `${t.kind}:${t.text.trim().toLowerCase().replace(/\s+/g, ' ')}`
  const themeTokens = (opts.theme ?? '')
    .toLowerCase()
    .split(/\s+/)
    .map((s) => s.trim())
    .filter(Boolean)
  let all = allRaw
  let note = ''
  if (opts.scope === 'recent' || opts.scope === 'weak' || opts.scope === 'due' || opts.scope === 'mistakes') {
    all = allRaw.filter((t) => {
      const p = progress.get(targetKey(t))
      if (!p) return opts.scope === 'due'
      if (opts.scope === 'recent') {
        const last = Date.parse(p.lastAt)
        return Number.isFinite(last) && Number.isFinite(now) && now - last <= 7 * 86_400_000
      }
      if (opts.scope === 'weak') return p.misses > 0 || p.hits / Math.max(1, p.attempts) < 0.7
      if (opts.scope === 'due') {
        const due = Date.parse(p.dueAt)
        return !Number.isFinite(due) || !Number.isFinite(now) || due <= now
      }
      return p.misses > 0
    })
    if (!all.length) {
      all = allRaw
      note = `「${PRODUCTION_SCOPE_LABEL[opts.scope]}」没有匹配目标块，已回退全库。`
    }
  } else if (opts.scope === 'theme' && themeTokens.length) {
    all = allRaw.filter((t) => {
      const hay = `${t.text} ${t.meaning}`.toLowerCase()
      return themeTokens.some((token) => hay.includes(token))
    })
    if (!all.length) {
      all = allRaw
      note = '主题没有匹配目标块，已回退全库。'
    }
  }
  if (!all.length) return { targets: [], total: 0, weak: 0, ...(note ? { note } : {}) }

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
  return {
    targets: shuffle(picked, rng),
    total: all.length,
    weak: weak.length,
    ...(note ? { note } : {}),
  }
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

const IRREGULAR_WORDS: Record<string, string[]> = {
  be: ['am', 'is', 'are', 'was', 'were', 'been', 'being'],
  become: ['became', 'becoming'],
  begin: ['began', 'begun', 'beginning'],
  break: ['broke', 'broken', 'breaking'],
  bring: ['brought', 'bringing'],
  buy: ['bought', 'buying'],
  choose: ['chose', 'chosen', 'choosing'],
  come: ['came', 'coming'],
  do: ['did', 'done', 'doing', 'does'],
  drink: ['drank', 'drunk', 'drinking'],
  drive: ['drove', 'driven', 'driving'],
  eat: ['ate', 'eaten', 'eating'],
  fall: ['fell', 'fallen', 'falling'],
  feel: ['felt', 'feeling'],
  find: ['found', 'finding'],
  fly: ['flew', 'flown', 'flying'],
  forget: ['forgot', 'forgotten', 'forgetting'],
  get: ['got', 'gotten', 'getting'],
  give: ['gave', 'given', 'giving'],
  go: ['went', 'gone', 'going', 'goes'],
  grow: ['grew', 'grown', 'growing'],
  have: ['has', 'had', 'having'],
  hear: ['heard', 'hearing'],
  keep: ['kept', 'keeping'],
  know: ['knew', 'known', 'knowing'],
  leave: ['left', 'leaving'],
  lose: ['lost', 'losing'],
  make: ['made', 'making'],
  meet: ['met', 'meeting'],
  pay: ['paid', 'paying'],
  put: ['putting'],
  read: ['reading'],
  run: ['ran', 'running'],
  say: ['said', 'saying'],
  see: ['saw', 'seen', 'seeing'],
  sell: ['sold', 'selling'],
  send: ['sent', 'sending'],
  show: ['showed', 'shown', 'showing'],
  sit: ['sat', 'sitting'],
  sleep: ['slept', 'sleeping'],
  speak: ['spoke', 'spoken', 'speaking'],
  spend: ['spent', 'spending'],
  stand: ['stood', 'standing'],
  take: ['took', 'taken', 'taking'],
  teach: ['taught', 'teaching'],
  tell: ['told', 'telling'],
  think: ['thought', 'thinking'],
  understand: ['understood', 'understanding'],
  wear: ['wore', 'worn', 'wearing'],
  win: ['won', 'winning'],
  write: ['wrote', 'written', 'writing'],
}

/** 目标块是否出现在作答里：单词允许常见词形 / 不规则变化，词组允许插入少量词。 */
export function targetUsed(answer: string, target: ProductionTarget): boolean {
  const hay = normalizeText(answer)
  const needle = normalizeText(target.text)
  if (!needle) return false
  if (target.kind !== 'word') {
    if (hay.includes(needle)) return true
    const words = needle.split(' ').filter(Boolean)
    if (words.length < 2) return false
    const pattern = words.map(escapeRegExp).join('(?:\\s+\\S+){0,2}\\s+')
    return new RegExp(`\\b${pattern}\\b`, 'i').test(hay)
  }
  const last = needle.slice(-1)
  const forms = new Set([
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
    ...(IRREGULAR_WORDS[needle] ?? []),
  ])
  const re = new RegExp(`\\b(?:${[...forms].map(escapeRegExp).join('|')})\\b`, 'i')
  return re.test(hay)
}

export interface ClozePart {
  text: string
  /** 有 target = 这里要填空；`text` 是原目标块文本。 */
  target?: ProductionTarget
}

/** 把参考句按目标块切成「普通文本 / 空」两段，供真正的填空交互使用。 */
export function clozeParts(model: string, targets: readonly ProductionTarget[]): ClozePart[] {
  const sorted = [...targets]
    .filter((t) => t.text.trim())
    .sort((a, b) => b.text.length - a.text.length)
  if (!sorted.length) return [{ text: model }]
  const byText = new Map(sorted.map((t) => [t.text.trim().toLowerCase(), t]))
  const re = new RegExp(`(${sorted.map((t) => escapeRegExp(t.text.trim())).join('|')})`, 'gi')
  const parts: ClozePart[] = []
  for (const piece of model.split(re)) {
    if (!piece) continue
    const target = byText.get(piece.trim().toLowerCase())
    parts.push(target ? { text: piece, target } : { text: piece })
  }
  return parts.length ? parts : [{ text: model }]
}

/** 把目标块从参考句里挖掉，用于「句中挖空」提示。 */
export function clozeSentence(model: string, targets: readonly ProductionTarget[]): string {
  return clozeParts(model, targets)
    .map((p) => (p.target ? '_____' : p.text))
    .join('')
}

/** 把参考句拆成词，按 seed 稳定洗牌，用于「排序」提示。 */
export function shuffledWords(model: string, seed: string): string[] {
  const words = model.trim().split(/\s+/).filter(Boolean)
  let h = 5381
  for (let i = 0; i < seed.length; i++) h = ((h << 5) + h + seed.charCodeAt(i)) | 0
  for (let i = words.length - 1; i > 0; i--) {
    h = (h * 1103515245 + 12345) | 0
    const j = Math.abs(h) % (i + 1)
    ;[words[i], words[j]] = [words[j], words[i]]
  }
  return words
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
