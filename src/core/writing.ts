/**
 * 仿写训练：从范句生成「仿写任务 + 评分 rubric」，写完再让 AI **严格**批改。
 *
 * 两轮都是纯文本 → JSON：
 *   1) 出任务：给范句 → { task, model, mustUse, rubric }
 *   2) 批改：给任务 + 学生作答 → { version, scores, issues, recommendations, polished, summary }
 *
 * 提示词刻意强调「严格、就事论事、指出具体错误、给可直接用的改法」，杜绝「很棒/下次注意」式空话。
 * 解析层对不合格的 JSON 直接返回空，不放水。
 *
 * v2 批改契约（2026-10 起）：每条 issue 必须带闭集 `rule` + 稳定的 `key`，
 * AI 额外给 0–3 条 `recommendations`（可加入本课的语言点）。旧记录由
 * `tools/backfill-writing-v2.mjs` 一次性回填，不做长期双读。
 */

import { dayKeyLocal } from './activity'
import {
  classifyLegacyIssue,
  isWritingIssueKey,
  isWritingRule,
  writingKeyFor,
  writingRuleCatalog,
  writingTypeOf,
  type WritingIssueType,
  type WritingRule,
} from './writingErrorRules'

export type { WritingIssueType, WritingRule } from './writingErrorRules'

export interface RubricItem {
  dimension: string
  weight: number
  description?: string
}

export interface ImitationTask {
  task: string
  model: string
  structure?: string
  mustUse: string[]
  rubric: RubricItem[]
  /** 「语言点造句」：必须用上的那个词块；普通仿写没有这个字段 */
  focus?: string
  /** 第几稿：按批改意见改写后是 2；首稿不写 */
  round?: number
}

export interface WritingScore {
  dimension: string
  score: number
  max: number
  comment?: string
}

export type WritingSeverity = 'must-fix' | 'improvement'

export interface WritingIssue {
  /** 原文片段 */
  original: string
  /** 建议改法 */
  suggestion: string
  reason?: string
  /** 由 rule 推导，不允许视图另算一份 */
  type: WritingIssueType
  /** 闭集错因；跨句 / 跨篇趋势的归一键 */
  rule: WritingRule
  /** 这一条错因的具体身份（复习卡 / 去重） */
  key: string
  severity: WritingSeverity
}

export const WRITING_RECOMMENDATION_KINDS = [
  'chunk',
  'pattern',
  'collocation',
  'usage',
  'grammar',
] as const

export type WritingRecommendationKind = (typeof WRITING_RECOMMENDATION_KINDS)[number]

export const WRITING_RECOMMENDATION_FROM = ['error', 'article', 'ai'] as const

export type WritingRecommendationFrom = (typeof WRITING_RECOMMENDATION_FROM)[number]

export interface WritingRecommendation {
  kind: WritingRecommendationKind
  /** 英文语言点本身（词块 / 句型 / 搭配） */
  point: string
  zh?: string
  why: string
  example?: string
  priority: 1 | 2 | 3
  from: WritingRecommendationFrom
  /** 来自哪条错因（from = error 时） */
  issueKey?: string
  /** 文章自带语言点 id（from = article 时） */
  pointId?: string
}

export interface WritingFeedback {
  /** 2 = issues 带 rule/key；旧记录回填后也是 2。显示层允许缺失（旧备份）。 */
  version?: 2
  scores: WritingScore[]
  total: number
  max: number
  issues: WritingIssue[]
  recommendations?: WritingRecommendation[]
  polished?: string
  summary?: string
}

/** 只认 v2：分析 / 趋势 / 复习入口用这个判断，旧记录必须先回填。 */
export function isWritingFeedbackV2(feedback: WritingFeedback | null | undefined): boolean {
  return feedback?.version === 2
}


function stripFence(raw: string): string {
  const m = raw.match(/```(?:json)?\s*([\s\S]*?)```/i)
  return (m ? m[1] : raw).trim()
}

function asString(v: unknown): string {
  return typeof v === 'string' ? v.trim() : ''
}

function asStringArray(v: unknown): string[] {
  return Array.isArray(v) ? v.map(asString).filter(Boolean) : []
}

function asNumber(v: unknown): number {
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? n : 0
}

/** 出题提示词：给定范句（可带结构与要用的搭配），生成仿写任务 + rubric。 */
export function buildImitationTaskPrompt(input: {
  model: string
  structure?: string
  mustUse?: string[]
}): string {
  const mustUse = input.mustUse?.filter(Boolean) ?? []
  return [
    '你是英语写作教练。请基于下面这个**范句**，设计一个「仿写」任务，用于训练中国学生的英语写作。',
    '',
    '要求：',
    '- task：用中文清楚说明让学生写什么（话题/情境/需要写几句），要能从范句的结构迁移；',
    '- structure：一句话点出范句值得模仿的句型结构；',
    `- mustUse：必须用上的词 / 搭配（${mustUse.length ? '就用这些' : '从范句里挑 2–3 个'}）：${mustUse.join('、') || '（自定）'}；`,
    '- rubric：3–4 个评分维度（如 语法准确 / 结构运用 / 用词地道 / 连贯），每个给权重（加起来 100），并写清扣分标准；',
    '- 不要让学生逐字翻译范句，要换内容、套结构。',
    '',
    '只输出一个 JSON 对象，不要任何其他文字。格式：',
    '{"task":"...","model":"范句原文","structure":"...","mustUse":["..."],"rubric":[{"dimension":"语法准确","weight":30,"description":"..."}]}',
    '',
    '范句：',
    '"""',
    input.model.trim(),
    '"""',
    input.structure ? `结构提示：${input.structure}` : '',
  ]
    .filter(Boolean)
    .join('\n')
}

/** 解析仿写任务；缺 task/model 视为不合格。 */
export function parseImitationTask(raw: string): ImitationTask | null {
  const text = stripFence(raw)
  if (!text) return null
  let obj: unknown
  try {
    obj = JSON.parse(text)
  } catch {
    return null
  }
  if (!obj || typeof obj !== 'object') return null
  const o = obj as Record<string, unknown>
  const task = asString(o.task)
  const model = asString(o.model)
  if (!task || !model) return null
  const rubric: RubricItem[] = []
  if (Array.isArray(o.rubric)) {
    for (const r of o.rubric) {
      if (!r || typeof r !== 'object') continue
      const ro = r as Record<string, unknown>
      const dimension = asString(ro.dimension)
      if (!dimension) continue
      rubric.push({ dimension, weight: asNumber(ro.weight), description: asString(ro.description) || undefined })
    }
  }
  return {
    task,
    model,
    structure: asString(o.structure) || undefined,
    mustUse: asStringArray(o.mustUse),
    rubric,
  }
}

export interface WritingFeedbackPromptOptions {
  /** 文章自带的语言点（只能从里面挑 pointId，防止 AI 编出不存在的点） */
  availablePoints?: ReadonlyArray<{ id: string; en: string; zh?: string; kind?: string }>
  /** 第二稿：上一轮批改的 issues，让 AI 专查「改了没」 */
  previousIssues?: ReadonlyArray<
    Pick<WritingIssue, 'original' | 'suggestion' | 'reason' | 'rule' | 'key'>
  >
}

/** 批改提示词：给定任务与评分标准 + 学生作答，要求严格批改。 */
export function buildWritingFeedbackPrompt(
  task: ImitationTask,
  userText: string,
  options: WritingFeedbackPromptOptions = {},
): string {
  const rubric = task.rubric.length
    ? task.rubric.map((r) => `- ${r.dimension}（满分 ${r.weight}）：${r.description ?? ''}`).join('\n')
    : '- 语法准确（满分 40）\n- 用词与搭配（满分 30）\n- 结构与连贯（满分 30）'
  const points = options.availablePoints?.filter((p) => p.en.trim()) ?? []
  const pointLines = points.length
    ? points.map((p) => `- ${p.id} | ${p.en}${p.zh ? ` | ${p.zh}` : ''}${p.kind ? ` | ${p.kind}` : ''}`).join('\n')
    : '（本题没有可选语言点；recommendations 里不要写 pointId / from=article）'
  const previous = options.previousIssues?.filter((i) => i.suggestion.trim()) ?? []
  const previousBlock = previous.length
    ? [
        '这是改写后的新稿。上一稿批改指出过这些问题：',
        ...previous.map(
          (i) =>
            `- [${i.rule}/${i.key}] “${i.original || '（缺词）'}” → “${i.suggestion}”${i.reason ? `（${i.reason}）` : ''}`,
        ),
        '请逐条检查：已经改掉的不要再报；仍然存在或改错的继续报，并尽量沿用同一个 rule/key；',
        '另外照常检查新出现的问题。',
        '',
      ]
    : []
  return [
    '你是严格的英语写作批改老师。请批改下面这篇仿写。**就事论事，不要客套、不要泛泛鼓励。**',
    '',
    '批改要求（必须严格遵守）：',
    '- 只依据下面的评分标准打分；每项都要给出**具体** comment，指出扣分对应的原句；',
    '- issues 要逐条列出**真实存在的**问题：original 必须是学生原文里**逐字**出现的片段（不要改写），suggestion 给可直接替换的正确写法，reason 说明为什么错（语法/搭配/中式英语等）；',
    '- 同一条错误只报一次；不要为了凑数把「可以更好」写成「错」；',
    '- rule 必须从下面的闭集里选；key 用稳定的小写连字符 slug（同一种错误跨句、跨篇保持同一个 key，具体词块用具体片段，如 chunk-come-to-an-end）；',
    '- severity：硬错（拼写 / 语法 / 搭配 / 词块 / 语义错）写 must-fix；只是更地道的表达写 improvement；',
    '- recommendations 给 0–3 条**可复习 / 可加入本课**的语言点。kind 只能是 chunk / pattern / collocation / usage（纯语法规则不要放这里，放进 issues）；',
    '- recommendations 的 why 要说明「和你这次的错/这篇的主题有什么关系」；from=error 时带对应 issueKey，from=article 时只能从下面语言点里选并带 pointId，自己想到的写 from=ai；',
    '- polished 给一份**完整改写**（保留学生原意，修正所有问题）；',
    '- summary 用中文 2–3 句总结，直说最需要改的地方。',
    '',
    '错因规则闭集（rule: 说明）：',
    writingRuleCatalog(),
    '',
    ...previousBlock,
    '评分标准：',
    rubric,
    '',
    '任务：',
    task.task,
    `（范句：${task.model}${task.mustUse.length ? `；要求用上：${task.mustUse.join('、')}` : ''}）`,
    '',
    '可选语言点（id | 英文 | 中文 | 类型）：',
    pointLines,
    '',
    '学生作答：',
    '"""',
    userText.trim(),
    '"""',
    '',
    '只输出一个 JSON 对象，不要任何其他文字。格式：',
    '{"version":2,"scores":[{"dimension":"语法准确","score":32,"max":40,"comment":"..."}],"total":82,"max":100,',
    '"issues":[{"original":"学生原文片段","suggestion":"正确写法","reason":"为什么错","rule":"chunk-sense","key":"chunk-come-to-an-end","severity":"must-fix"}],',
    '"recommendations":[{"kind":"chunk","point":"come to an end","zh":"结束","why":"你这次把 an end to 当成了独立词块","example":"The meeting came to an end.","priority":1,"from":"error","issueKey":"chunk-come-to-an-end"}],',
    '"polished":"...","summary":"..."}',
  ].join('\n')
}

export interface WritingFeedbackDropped {
  /** 无法定位 / 缺建议 / 重复的 issues 条数 */
  issues: number
  /** 缺字段 / 重复 / 不在白名单的 recommendations 条数 */
  recommendations: number
  /** 缺 rule/key、由启发式补全的条数（不是丢弃，但要在界面提示） */
  inferred: number
  reasons: string[]
}

export interface WritingFeedbackParse {
  feedback: WritingFeedback
  dropped: WritingFeedbackDropped
}

export interface WritingFeedbackParseOptions {
  /** 学生原文；给了就校验 original 必须逐字出现，防止 AI 编原文 */
  answer?: string
  /** 文章可选语言点 id；给了就校验 from=article 的 pointId */
  availablePointIds?: ReadonlySet<string>
}

function normalizeReasonList(list: string[]): string[] {
  return [...new Set(list.map((s) => s.trim()).filter(Boolean))].slice(0, 5)
}

function parseRecommendation(
  raw: unknown,
  issueKeys: ReadonlySet<string>,
  availablePointIds: ReadonlySet<string> | undefined,
  dropped: WritingFeedbackDropped,
): WritingRecommendation | null {
  if (!raw || typeof raw !== 'object') {
    dropped.recommendations++
    return null
  }
  const o = raw as Record<string, unknown>
  const kind = asString(o.kind)
  if (!(WRITING_RECOMMENDATION_KINDS as readonly string[]).includes(kind)) {
    dropped.recommendations++
    dropped.reasons.push(`recommendation kind 不在白名单：${kind || '空'}`)
    return null
  }
  const point = asString(o.point)
  const why = asString(o.why)
  if (!point || !why) {
    dropped.recommendations++
    dropped.reasons.push('recommendation 缺 point / why')
    return null
  }
  const fromRaw = asString(o.from)
  const from = (WRITING_RECOMMENDATION_FROM as readonly string[]).includes(fromRaw)
    ? (fromRaw as WritingRecommendationFrom)
    : 'ai'
  const priorityRaw = asNumber(o.priority)
  const priority: 1 | 2 | 3 = priorityRaw === 1 ? 1 : priorityRaw === 3 ? 3 : 2
  const pointId = asString(o.pointId) || undefined
  if (from === 'article') {
    if (!pointId) {
      dropped.recommendations++
      dropped.reasons.push('recommendation from=article 但缺 pointId')
      return null
    }
    if (availablePointIds && !availablePointIds.has(pointId)) {
      dropped.recommendations++
      dropped.reasons.push(`recommendation pointId 不在本题语言点里：${pointId}`)
      return null
    }
  }
  const issueKey = asString(o.issueKey) || undefined
  if (issueKey && !issueKeys.has(issueKey)) {
    // 不丢推荐本身，但把悬空引用摘掉；趋势仍可用 point 本身。
    dropped.reasons.push(`recommendation issueKey 没对应 issue：${issueKey}`)
  }
  return {
    kind: kind as WritingRecommendationKind,
    point,
    zh: asString(o.zh) || undefined,
    why,
    example: asString(o.example) || undefined,
    priority,
    from,
    issueKey: issueKey && issueKeys.has(issueKey) ? issueKey : undefined,
    pointId,
  }
}

/**
 * 解析批改结果；至少要有 scores 或 issues 才算有效。
 *
 * 严格点：issues 的 suggestion 必须有；给了 answer 时 original 必须逐字出现；
 * rule/key 缺失时用闭集启发式补全并计入 `inferred`（回填旧记录的同一套逻辑）。
 */
export function parseWritingFeedbackDetailed(
  raw: string,
  options: WritingFeedbackParseOptions = {},
): WritingFeedbackParse | null {
  const text = stripFence(raw)
  if (!text) return null
  let obj: unknown
  try {
    obj = JSON.parse(text)
  } catch {
    return null
  }
  if (!obj || typeof obj !== 'object') return null
  const o = obj as Record<string, unknown>
  const dropped: WritingFeedbackDropped = { issues: 0, recommendations: 0, inferred: 0, reasons: [] }
  const scores: WritingScore[] = []
  if (Array.isArray(o.scores)) {
    for (const s of o.scores) {
      if (!s || typeof s !== 'object') continue
      const so = s as Record<string, unknown>
      const dimension = asString(so.dimension)
      if (!dimension) continue
      scores.push({
        dimension,
        score: asNumber(so.score),
        max: asNumber(so.max),
        comment: asString(so.comment) || undefined,
      })
    }
  }
  const issues: WritingIssue[] = []
  const seenIssues = new Set<string>()
  if (Array.isArray(o.issues)) {
    for (const s of o.issues) {
      if (!s || typeof s !== 'object') {
        dropped.issues++
        continue
      }
      const so = s as Record<string, unknown>
      const original = asString(so.original)
      const suggestion = asString(so.suggestion)
      const reason = asString(so.reason) || undefined
      if (!suggestion) {
        dropped.issues++
        dropped.reasons.push('issue 缺 suggestion')
        continue
      }
      if (options.answer && original && !options.answer.includes(original)) {
        dropped.issues++
        dropped.reasons.push(`original 不在学生原文里：${original.slice(0, 40)}`)
        continue
      }
      const fallback = classifyLegacyIssue({ original, suggestion, reason })
      let rule: WritingRule
      if (isWritingRule(so.rule)) {
        rule = so.rule
      } else {
        rule = fallback.rule
        dropped.inferred++
      }
      let key: string
      if (isWritingIssueKey(so.key)) {
        key = so.key
      } else {
        key = writingKeyFor(rule, original, suggestion)
        dropped.inferred++
      }
      const severityRaw = asString(so.severity)
      const severity: WritingSeverity =
        severityRaw === 'improvement' || severityRaw === 'must-fix' ? severityRaw : fallback.severity
      const dedupe = `${key}|${original}|${suggestion}`
      if (seenIssues.has(dedupe)) {
        dropped.issues++
        continue
      }
      seenIssues.add(dedupe)
      issues.push({
        original,
        suggestion,
        reason,
        type: writingTypeOf(rule),
        rule,
        key,
        severity,
      })
      if (issues.length >= 20) break
    }
  }
  const issueKeys = new Set(issues.map((i) => i.key))
  const recommendations: WritingRecommendation[] = []
  const seenRecommendations = new Set<string>()
  if (Array.isArray(o.recommendations)) {
    for (const r of o.recommendations) {
      const rec = parseRecommendation(r, issueKeys, options.availablePointIds, dropped)
      if (!rec) continue
      const dedupe = `${rec.kind}|${rec.point.toLowerCase()}`
      if (seenRecommendations.has(dedupe)) {
        dropped.recommendations++
        continue
      }
      seenRecommendations.add(dedupe)
      recommendations.push(rec)
      if (recommendations.length >= 5) break
    }
  }
  if (!scores.length && !issues.length) return null
  const total = asNumber(o.total) || scores.reduce((a, s) => a + s.score, 0)
  const max = asNumber(o.max) || scores.reduce((a, s) => a + s.max, 0)
  dropped.reasons = normalizeReasonList(dropped.reasons)
  return {
    feedback: {
      version: 2,
      scores,
      total,
      max,
      issues,
      recommendations,
      polished: asString(o.polished) || undefined,
      summary: asString(o.summary) || undefined,
    },
    dropped,
  }
}

/** 兼容旧调用：只要结果，不要丢弃计数。 */
export function parseWritingFeedback(
  raw: string,
  options: WritingFeedbackParseOptions = {},
): WritingFeedback | null {
  return parseWritingFeedbackDetailed(raw, options)?.feedback ?? null
}


/** 一次仿写练习的记录（存本机，供回看进步）。 */
export interface WritingRecord {
  at: string
  articleId: string
  articleTitle?: string
  model: string
  text: string
  feedback: WritingFeedback
  /** 当时的仿写任务（题目 + rubric），可能没有 */
  task?: ImitationTask
  /** 普通仿写缺省；金句课记录（单句仿写 / 整课考试 / 错因订正）分开标记，历史可分流 */
  source?: 'writing' | 'goldenExam' | 'goldenSentence' | 'goldenError'
  /** 金句课考试题 id（source = goldenExam 时） */
  examId?: string
  /** 金句课单句 id（source = goldenSentence 时） */
  sentenceId?: string
  /**
   * 记录级稳定键：`writing_records.id` 每次同步都会变（整段删了重插），
   * 错因进度 / 复习卡不能拿它当身份。旧记录没有时用 `writingRecordKey()` 现算。
   */
  recordKey?: string
}

function textFingerprint(text: string): string {
  let h = 5381
  for (let i = 0; i < text.length; i++) h = ((h << 5) + h + text.charCodeAt(i)) | 0
  return (h >>> 0).toString(36)
}

/** 一条批改记录的稳定身份（不依赖 DB 自增 id）。 */
export function writingRecordKey(
  rec: Pick<WritingRecord, 'at' | 'articleId' | 'text'> &
    Partial<Pick<WritingRecord, 'sentenceId' | 'examId' | 'task'>>,
): string {
  const focus = rec.task?.focus?.trim() ?? ''
  const round = rec.task?.round ?? 1
  const owner = rec.sentenceId ?? rec.examId ?? ''
  return [rec.at, rec.articleId, owner, focus, String(round), textFingerprint(rec.text)].join('|')
}


/** 金句课产生的记录（单句仿写 / 整课考试 / 错因订正），普通仿写历史不混入。 */
export function isGoldenWritingRecord(rec: WritingRecord): boolean {
  return rec.source === 'goldenExam' || rec.source === 'goldenSentence' || rec.source === 'goldenError'
}

const WRITING_SOURCES = ['writing', 'goldenSentence', 'goldenExam', 'goldenError'] as const

/**
 * 一条批改记录的**外部数据守卫**（localStorage / 服务端 / 备份都可能带脏值）。
 *
 * 只做两件事：来源按白名单（坏值当普通仿写，别让一条脏数据把金句课历史带歪），
 * 关联 id 必须是字符串（数字 / 对象一律丢掉）。服务端 `sqliteLearning` 写读两侧
 * 也是同一套白名单，两侧口径必须一致，否则「刷新前有、刷新后没了」。
 */
export function normalizeWritingRecord(rec: WritingRecord): WritingRecord {
  const source = (WRITING_SOURCES as readonly string[]).includes(rec.source as string)
    ? (rec.source as WritingRecord['source'])
    : undefined
  const id = (v: unknown) => (typeof v === 'string' && v ? v : undefined)
  const sentenceId = id(rec.sentenceId)
  const examId = id(rec.examId)
  return {
    ...rec,
    ...(source ? { source } : { source: undefined }),
    ...(sentenceId ? { sentenceId } : { sentenceId: undefined }),
    ...(examId ? { examId } : { examId: undefined }),
    recordKey: rec.recordKey || writingRecordKey(rec),
  }
}

const WRITING_SOURCE_LABEL: Record<NonNullable<WritingRecord['source']>, string> = {
  writing: '仿写',
  goldenSentence: '单句仿写',
  goldenExam: '整课考试',
  goldenError: '错因订正',
}

/**
 * 一条批改记录叫什么（历史列表 / 导出 / 打印共用这一处口径）。
 *
 * 金句课的「语言点造句」和「单句仿写」都属于 `source='goldenSentence'`，
 * 靠 `task.focus` 区分：有 focus 就是只练一个词块的那道题。
 */
export function writingRecordLabel(rec: Pick<WritingRecord, 'source' | 'task'>): string {
  const base = baseLabel(rec)
  const round = rec.task?.round ?? 1
  return round > 1 ? `${base}（第 ${round} 稿）` : base
}

function baseLabel(rec: Pick<WritingRecord, 'source' | 'task'>): string {
  if (rec.source === 'goldenError') return WRITING_SOURCE_LABEL.goldenError
  if (rec.source === 'goldenExam') return WRITING_SOURCE_LABEL.goldenExam
  if (rec.source === 'goldenSentence') {
    const focus = rec.task?.focus?.trim()
    return focus ? `语言点造句 · ${focus}` : WRITING_SOURCE_LABEL.goldenSentence
  }
  return WRITING_SOURCE_LABEL.writing
}

/**
 * 仿写 / 语言点造句的历史：**存不截断，只分页显示**。
 *
 * 这些记录是学习资产（AI 批改原文只有这一份），200 条时几篇文章就满了，旧记录会被静默截掉
 * （2026-10-29 发现：金句课每句可练 1 + N 个语言点，还会写第二稿，200 条一周就能用完）。
 * 所以落盘一条都不删；到 `WRITING_HISTORY_WARN_AT` 时提示导出归档，
 * 列表渲染用 `historyPage` 分页（一页 `WRITING_HISTORY_PAGE` 条），避免一次画几千行 DOM。
 */
export const WRITING_HISTORY_WARN_AT = 5000

/** 学习历史一页显示多少条（只是渲染分页，数据一条都不丢）。 */
export const WRITING_HISTORY_PAGE = 100

/** 渲染分页：取前 `shown` 条，并告诉界面还剩几条没显示（纯函数）。 */
export function historyPage<T>(
  list: readonly T[],
  shown: number,
  page = WRITING_HISTORY_PAGE,
): { rows: T[]; rest: number; next: number } {
  const limit = Math.max(page, Number.isFinite(shown) ? shown : page)
  const rows = list.slice(0, limit)
  return { rows, rest: Math.max(0, list.length - rows.length), next: limit + page }
}

/** 追加一条记录到最前，并按上限截断（纯函数）。 */
export function addWritingRecord(
  list: WritingRecord[],
  rec: WritingRecord,
  cap = Number.POSITIVE_INFINITY,
): WritingRecord[] {
  return [rec, ...list].slice(0, Math.max(0, cap))
}

/**
 * 数某「逻辑日」写了几条（今日计划用）。`todayKey` 由 `core/activity.ts` 的
 * `dayKeyLocal` 算好传进来，这里不自己拼日期键；坏时间戳直接忽略。
 */
export function countWritesOnDay(list: WritingRecord[], todayKey: string): number {
  let n = 0
  for (const r of list) {
    const d = new Date(r.at)
    if (Number.isNaN(d.getTime())) continue
    if (dayKeyLocal(d) === todayKey) n++
  }
  return n
}



/** 一道题的历史批改：按题身份筛出来，按时间正序（最早在前，最后一条就是最新一稿）。 */
export interface WritingAttemptIdentity {
  articleId: string
  /** 单句仿写 / 语言点造句用句子 id */
  sentenceId?: string | null
  /** 整课考试用题目 id */
  examId?: string | null
  /** 语言点造句用 focus；普通仿写为空 */
  focus?: string | null
}

export function writingAttemptsFor(list: WritingRecord[], id: WritingAttemptIdentity): WritingRecord[] {
  const focus = id.focus?.trim() ?? ''
  return list
    .filter((r) => {
      if (r.articleId !== id.articleId) return false
      if (id.examId) return (r.examId ?? '') === id.examId
      if ((r.sentenceId ?? '') !== (id.sentenceId ?? '')) return false
      return (r.task?.focus?.trim() ?? '') === focus
    })
    .sort((a, b) => a.at.localeCompare(b.at))
}
