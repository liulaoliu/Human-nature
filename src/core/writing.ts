/**
 * 仿写训练：从范句生成「仿写任务 + 评分 rubric」，写完再让 AI **严格**批改。
 *
 * 两轮都是纯文本 → JSON：
 *   1) 出任务：给范句 → { task, model, mustUse, rubric }
 *   2) 批改：给任务 + 学生作答 → { scores, issues, polished, summary }
 *
 * 提示词刻意强调「严格、就事论事、指出具体错误、给可直接用的改法」，杜绝「很棒/下次注意」式空话。
 * 解析层对不合格的 JSON 直接返回空，不放水。
 */

import { dayKeyLocal } from './activity'

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

export interface WritingIssue {
  /** 原文片段 */
  original: string
  /** 建议改法 */
  suggestion: string
  reason?: string
}

export interface WritingFeedback {
  scores: WritingScore[]
  total: number
  max: number
  issues: WritingIssue[]
  polished?: string
  summary?: string
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

/** 批改提示词：给定任务与评分标准 + 学生作答，要求严格批改。 */
export function buildWritingFeedbackPrompt(task: ImitationTask, userText: string): string {
  const rubric = task.rubric.length
    ? task.rubric.map((r) => `- ${r.dimension}（满分 ${r.weight}）：${r.description ?? ''}`).join('\n')
    : '- 语法准确（满分 40）\n- 用词与搭配（满分 30）\n- 结构与连贯（满分 30）'
  return [
    '你是严格的英语写作批改老师。请批改下面这篇仿写。**就事论事，不要客套、不要泛泛鼓励。**',
    '',
    '批改要求（必须严格遵守）：',
    '- 只依据下面的评分标准打分；每项都要给出**具体** comment，指出扣分对应的原句；',
    '- issues 要逐条列出**真实存在的**问题：original 必须是学生原文里**逐字**出现的片段（不要改写），suggestion 给可直接替换的正确写法，reason 说明为什么错（语法/搭配/中式英语等）；',
    '- 没有把握就不要编造问题；确实没问题就给空数组；',
    '- polished 给一份**完整改写**（保留学生原意，修正所有问题）；',
    '- summary 用中文 2–3 句总结，直说最需要改的地方。',
    '',
    '评分标准：',
    rubric,
    '',
    '任务：',
    task.task,
    `（范句：${task.model}${task.mustUse.length ? `；要求用上：${task.mustUse.join('、')}` : ''}）`,
    '',
    '学生作答：',
    '"""',
    userText.trim(),
    '"""',
    '',
    '只输出一个 JSON 对象，不要任何其他文字。格式：',
    '{"scores":[{"dimension":"语法准确","score":32,"max":40,"comment":"..."}],"total":82,"max":100,"issues":[{"original":"学生原文片段","suggestion":"正确写法","reason":"..."}],"polished":"...","summary":"..."}',
  ].join('\n')
}

/** 解析批改结果；至少要有 scores 或 issues 才算有效。 */
export function parseWritingFeedback(raw: string): WritingFeedback | null {
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
  if (Array.isArray(o.issues)) {
    for (const s of o.issues) {
      if (!s || typeof s !== 'object') continue
      const so = s as Record<string, unknown>
      const suggestion = asString(so.suggestion)
      if (!suggestion) continue
      issues.push({
        original: asString(so.original),
        suggestion,
        reason: asString(so.reason) || undefined,
      })
    }
  }
  if (!scores.length && !issues.length) return null
  const total = asNumber(o.total) || scores.reduce((a, s) => a + s.score, 0)
  const max = asNumber(o.max) || scores.reduce((a, s) => a + s.max, 0)
  return {
    scores,
    total,
    max,
    issues,
    polished: asString(o.polished) || undefined,
    summary: asString(o.summary) || undefined,
  }
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
  /** 普通仿写缺省；金句课单句仿写 / 整课考试分开标记，历史可分流 */
  source?: 'writing' | 'goldenExam' | 'goldenSentence'
  /** 金句课考试题 id（source = goldenExam 时） */
  examId?: string
  /** 金句课单句 id（source = goldenSentence 时） */
  sentenceId?: string
}

/** 金句课产生的记录（单句仿写 / 整课考试），普通仿写历史不混入。 */
export function isGoldenWritingRecord(rec: WritingRecord): boolean {
  return rec.source === 'goldenExam' || rec.source === 'goldenSentence'
}

const WRITING_SOURCE_LABEL: Record<NonNullable<WritingRecord['source']>, string> = {
  writing: '仿写',
  goldenSentence: '单句仿写',
  goldenExam: '整课考试',
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
  if (rec.source === 'goldenExam') return WRITING_SOURCE_LABEL.goldenExam
  if (rec.source === 'goldenSentence') {
    const focus = rec.task?.focus?.trim()
    return focus ? `语言点造句 · ${focus}` : WRITING_SOURCE_LABEL.goldenSentence
  }
  return WRITING_SOURCE_LABEL.writing
}

/**
 * 仿写 / 语言点造句的历史上限。
 *
 * 这些记录是学习资产（AI 批改原文只有这一份），200 条时几篇文章就满了，旧记录会被静默截掉
 * （2026-10-29 发现：金句课每句可练 1 + N 个语言点，还会写第二稿，200 条一周就能用完）。
 * 所以默认**不截断**（真丢数据），只在超过  时提示导出归档。
 */
export const WRITING_HISTORY_WARN_AT = 5000

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
