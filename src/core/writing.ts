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
