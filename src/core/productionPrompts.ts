import {
  PRODUCTION_ANGLE_LABEL,
  PRODUCTION_LEVEL_LABEL,
  PRODUCTION_MODE_LABEL,
  PRODUCTION_TONE_LABEL,
  type ProductionAngle,
  type ProductionDirection,
  type ProductionLevel,
  type ProductionMode,
  type ProductionPrompt,
  type ProductionTarget,
  type ProductionTargetHit,
  type ProductionTone,
  type YogurtSplitMode,
} from './production'
import {
  buildWritingFeedbackPrompt,
  parseWritingFeedbackDetailed,
  type ImitationTask,
  type WritingFeedback,
  type WritingFeedbackParse,
  type WritingIssue,
} from './writing'

export interface BuildProductionPackInput {
  mode: Exclude<ProductionMode, 'yogurt'>
  topic: string
  angle: ProductionAngle
  tone: ProductionTone
  level: ProductionLevel
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
  const full = input.mode === 'full'
  const topicLine = full
    ? '主题：随机自选（随机挑选日常生活 / 工作 / 学习 / 社交主题，不要围绕单一主题）'
    : `主题：${input.topic}`
  return [
    '你是英语产出训练的出题老师。请写中文情境提示，让学生用英文表达。',
    '',
    topicLine,
    `模式：${PRODUCTION_MODE_LABEL[input.mode]}`,
    `角度：${PRODUCTION_ANGLE_LABEL[input.angle]}`,
    `语气：${PRODUCTION_TONE_LABEL[input.tone]}`,
    `难度：${PRODUCTION_LEVEL_LABEL[input.level]}`,
    !full && input.articleTitle ? `参考文章：${input.articleTitle}` : '',
    '',
    '必须遵守：',
    `- 出 ${input.promptCount} 道题；每道题必须分配 ${input.targetsPerPrompt} 个目标块；`,
    '- 只能从下面候选清单里选 targetIds，不能编造；目标块不重复使用；',
    full
      ? '- 这是「全脂」随机模式：不要围绕一个主题；每道题换一个不同场景；目标块随机挑，不要总挑清单最前面的。'
      : '- 这是「脱脂奶」主题模式：所有题都围绕上述主题，但每道题的情境仍要具体、不同。',
    `- 难度按 ${PRODUCTION_LEVEL_LABEL[input.level]} 控制：B1 用短句和常见词，B2 允许复合句，C1 可以更抽象但必须自然；`,
    '- zh 必须是自然的中文情境 / 沟通目标，不能出现英文目标词，不能逐字提示英文句式；',
    '- model 必须是一句自然英文参考句，正确使用本题分配的目标块；它默认不展示，只在挖空 / 排序题型里作提示；',
    '- goal 用中文说明这句话要达成什么（如「委婉拒绝」「说明进度」「表达不同意见」）；',
    '- 题目之间尽量覆盖不同情境，不要 5 道题都在说同一件事；',
    '- 只输出 JSON，不要 Markdown、不要解释。',
    '',
    '候选目标块（id | 类型 | 英文 | 中文）：',
    targetLines,
    '',
    '输出格式：',
    '{"prompts":[{"zh":"中文情境","goal":"中文沟通目标","targetIds":["id1","id2"],"model":"完整英文参考句"}]}',
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
export interface BuildTopicPackInput {
  topic: string
  angle: ProductionAngle
  tone: ProductionTone
  level: ProductionLevel
  articleTitle: string
  promptCount: number
  /** 全脂关掉本机词块时：让 AI 自己随机定主题。 */
  randomTopic?: boolean
}

/** 只给主题（或让 AI 随机定主题），让 AI 出中文句子；不强制目标块。 */
export function buildTopicPackPrompt(input: BuildTopicPackInput): string {
  return [
    '你是英语产出训练的出题老师。请围绕主题写中文句子，让学生翻译成英文。',
    '',
    input.randomTopic
      ? '主题：随机自选（请自己挑一个具体的生活 / 工作 / 学习主题，不要问用户；不同题可以来自不同场景）'
      : `主题：${input.topic}`,
    `角度：${PRODUCTION_ANGLE_LABEL[input.angle]}`,
    `语气：${PRODUCTION_TONE_LABEL[input.tone]}`,
    `难度：${PRODUCTION_LEVEL_LABEL[input.level]}`,
    input.articleTitle && !input.randomTopic ? `参考文章：${input.articleTitle}` : '',
    '',
    '必须遵守：',
    `- 出 ${input.promptCount} 道题；每题只给一个中文句子 / 一个具体沟通情境；`,
    `- 难度按 ${PRODUCTION_LEVEL_LABEL[input.level]} 控制；长短交错，不要五道题都在说同一件事；`,
    '- 中文里不要出现英文答案，不要逐字提示英文句式；',
    '- goal 用中文说明这句话要达成什么（如「解释原因」「提出请求」「表达不同意见」）；',
    '- 只输出 JSON，不要 Markdown、不要解释。',
    '',
    '输出格式：',
    '{"prompts":[{"zh":"中文句子 / 情境","goal":"中文沟通目标"}]}',
  ]
    .filter(Boolean)
    .join('\n')
}

/** 解析脱脂奶题目包；不要求 targetIds。 */
export function parseTopicPack(raw: string, maxPrompts = 12): ProductionPrompt[] | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(stripFence(raw))
  } catch {
    return null
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
  const promptsRaw = (parsed as Record<string, unknown>).prompts
  if (!Array.isArray(promptsRaw)) return null
  const prompts: ProductionPrompt[] = []
  for (const [i, item] of promptsRaw.entries()) {
    if (i >= maxPrompts) break
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue
    const o = item as Record<string, unknown>
    const zh = asString(o.zh, 600)
    if (!zh) continue
    prompts.push({
      id: `topic-${i + 1}`,
      zh,
      goal: asString(o.goal, 300),
      targets: [],
    })
  }
  return prompts.length ? prompts : null
}

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
      ...(asString(o.model, 1500) ? { model: asString(o.model, 1500) } : {}),
    })
  }
  return prompts.length ? prompts : null
}

/** 按句 / 按行拆一段文本；两种语言共用，供风味酸奶预览编辑。 */
export function splitProductionSentences(text: string, mode: YogurtSplitMode = 'sentence'): string[] {
  const normalized = text.replace(/\r\n?/g, '\n').trim()
  if (!normalized) return []
  if (mode === 'line') {
    return normalized
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean)
  }
  const out: string[] = []
  for (const line of normalized.split('\n')) {
    const matches = line.match(/[^。！？!?；;.]+[。！？!?；;.]?/g) ?? []
    for (const part of matches) {
      const s = part.trim()
      if (s) out.push(s)
    }
  }
  return out
}

export interface YogurtPair {
  source: string
  reference: string
}

export interface YogurtPairResult {
  pairs: YogurtPair[]
  warning: string
  sourceCount: number
  referenceCount: number
}

/**
 * 先拆再配对。句数不一致时以短边为准，长边末尾并进最后一对；
 * 界面上的对齐编辑器可以在此基础上合并 / 拆分 / 移动。
 */
export function pairYogurtTexts(
  source: string,
  reference: string,
  mode: YogurtSplitMode = 'sentence',
): YogurtPairResult | null {
  const src = splitProductionSentences(source, mode)
  const ref = splitProductionSentences(reference, mode)
  if (!src.length || !ref.length) return null
  const n = Math.min(src.length, ref.length)
  const pairs: YogurtPair[] = []
  for (let i = 0; i < n; i++) {
    const last = i === n - 1
    const s = last ? src.slice(i).join(' ') : (src[i] ?? '')
    const r = last ? ref.slice(i).join(' ') : (ref[i] ?? '')
    if (!s && !r) continue
    pairs.push({ source: s, reference: r })
  }
  const warning =
    src.length === ref.length
      ? ''
      : `${src.length} 句 / ${ref.length} 句，句数不一致；已按顺序配对，末尾多出的内容并入最后一对。`
  return { pairs, warning, sourceCount: src.length, referenceCount: ref.length }
}

export interface YogurtPromptResult {
  prompts: ProductionPrompt[]
  /** 句数对不上时的提示；对得上就是空字符串 */
  warning: string
  sourceCount: number
  referenceCount: number
}

export function buildYogurtPromptsFromPairs(
  pairs: readonly YogurtPair[],
  direction: ProductionDirection = 'zh-en',
  warning = '',
  paragraph = false,
): YogurtPromptResult | null {
  const answerLang = direction === 'en-zh' ? 'zh' : 'en'
  const usable = pairs.filter((p) => p.source.trim() || p.reference.trim())
  const prompts: ProductionPrompt[] = usable.map((p, i) => ({
    id: `yogurt-${i + 1}`,
    zh: p.source.trim(),
    goal: direction === 'en-zh' ? '逐句英译中' : '逐句中译英',
    targets: [],
    ...(p.reference.trim() ? { reference: p.reference.trim() } : {}),
    answerLang,
  }))
  if (!prompts.length) return null
  if (paragraph && usable.length > 1) {
    const source = usable.map((p) => p.source.trim()).filter(Boolean).join(' ')
    const reference = usable.map((p) => p.reference.trim()).filter(Boolean).join(' ')
    if (source) {
      prompts.push({
        id: 'yogurt-paragraph',
        zh: source,
        goal: direction === 'en-zh' ? '整段英译中' : '整段中译英',
        targets: [],
        ...(reference ? { reference } : {}),
        answerLang,
      })
    }
  }
  return {
    prompts,
    warning,
    sourceCount: usable.length,
    referenceCount: usable.length,
  }
}

/**
 * 风味酸奶：把用户粘贴的中文原文 + 英文参考译文拆成逐句练习。
 *
 * 不依赖 AI；句数对不上时按顺序配对，末尾多出的内容并入最后一题，并返回 warning。
 * 英文参考只挂在 prompt 上，界面在作答 / 批改前不显示。
 */
export function buildYogurtPrompts(
  source: string,
  reference: string,
  direction: ProductionDirection = 'zh-en',
  mode: YogurtSplitMode = 'sentence',
  paragraph = false,
): YogurtPromptResult | null {
  const paired = pairYogurtTexts(source, reference, mode)
  if (!paired) return null
  return buildYogurtPromptsFromPairs(paired.pairs, direction, paired.warning, paragraph)
}

export interface ProductionQuality {
  ok: boolean
  reason: string
}

/** AI 题目包硬校验：数量、每题目标数、目标块不重复。 */
export function validateProductionPack(
  prompts: readonly ProductionPrompt[],
  expectedCount: number,
  targetsPerPrompt: number,
  requireModel = false,
): ProductionQuality {
  if (prompts.length !== expectedCount) {
    return { ok: false, reason: `应出 ${expectedCount} 道题，实际 ${prompts.length} 道` }
  }
  const used = new Set<string>()
  for (const [i, prompt] of prompts.entries()) {
    if (prompt.targets.length !== targetsPerPrompt) {
      return {
        ok: false,
        reason: `第 ${i + 1} 题应带 ${targetsPerPrompt} 个目标块，实际 ${prompt.targets.length} 个`,
      }
    }
    if (requireModel && !prompt.model?.trim()) {
      return { ok: false, reason: `第 ${i + 1} 题缺少英文参考句 model` }
    }
    for (const target of prompt.targets) {
      if (used.has(target.id)) return { ok: false, reason: `目标块「${target.text}」被重复使用` }
      used.add(target.id)
    }
  }
  return { ok: true, reason: '' }
}

/** 纯主题包硬校验：只查题目数量。 */
export function validateTopicPack(prompts: readonly ProductionPrompt[], expectedCount: number): ProductionQuality {
  return prompts.length === expectedCount
    ? { ok: true, reason: '' }
    : { ok: false, reason: `应出 ${expectedCount} 道题，实际 ${prompts.length} 道` }
}

export interface ProductionTask extends ImitationTask {
  kind: 'production'
  mode: ProductionMode
  topic: string
  goal: string
  promptId: string
  /** 同一组训练；历史里用它把第 1 / 2 稿并排。 */
  sessionId?: string
  /** 风味酸奶的方向：默认中→英；英→中时参考答案是中文。 */
  answerLang?: 'en' | 'zh'
  targets: ProductionTarget[]
  /** 风味酸奶的参考译文；批改提示词里会作为「范句」交给 AI */
  reference?: string
  hits?: ProductionTargetHit[]
}

/** 出评分任务：复用仿写批改的 rubric / mustUse / focus 口径。 */
export function makeProductionTask(
  prompt: ProductionPrompt,
  topic: string,
  mode: ProductionMode = 'skim',
  sessionId?: string,
): ProductionTask {
  const yogurt = mode === 'yogurt'
  const hasTargets = prompt.targets.length > 0
  const answerLang = prompt.answerLang ?? 'en'
  const zhAnswer = yogurt && answerLang === 'zh'
  return {
    kind: 'production',
    mode,
    task: prompt.zh,
    model: yogurt
      ? prompt.reference?.trim() || '（没有粘贴参考译文）'
      : '（自由表达，没有唯一范句）',
    goal: prompt.goal,
    promptId: prompt.id,
    ...(sessionId ? { sessionId } : {}),
    ...(yogurt ? { answerLang } : {}),
    topic,
    targets: prompt.targets,
    ...(yogurt && prompt.reference ? { reference: prompt.reference } : {}),
    mustUse: prompt.targets.map((t) => t.text),
    rubric: yogurt
      ? zhAnswer
        ? [
            { dimension: '英文原意', weight: 40, description: '英文原句的意思是否完整、准确，没有漏译 / 加戏' },
            { dimension: '中文自然度', weight: 30, description: '中文是否通顺、像正常表达，而不是逐字硬翻' },
            { dimension: '参考译文差距', weight: 30, description: '和参考译文相比，哪些表达更准确 / 更地道' },
          ]
        : [
            { dimension: '原文意思', weight: 40, description: '中文原文的意思是否完整、准确，没有漏译 / 加戏' },
            { dimension: '英文自然度', weight: 30, description: '语法、搭配、时态和语序是否自然' },
            { dimension: '参考译文差距', weight: 30, description: '和参考译文相比，哪些表达更准确 / 更地道，哪些地方差距大' },
          ]
      : hasTargets
        ? [
            { dimension: '意思到位', weight: 40, description: '中文情境想表达的意思是否完整、准确' },
            { dimension: '目标词块', weight: 30, description: '目标词 / 词组 / 习语是否用上且搭配正确' },
            { dimension: '语法与自然度', weight: 30, description: '语法、时态、冠词、介词和语序是否自然' },
          ]
        : [
            { dimension: '意思到位', weight: 40, description: '中文句子想表达的意思是否完整、准确' },
            { dimension: '语法与自然度', weight: 35, description: '语法、时态、冠词、介词和语序是否自然' },
            { dimension: '表达地道', weight: 25, description: '用词和搭配是否像正常英文，而不是逐字硬翻' },
          ],
    focus: yogurt
      ? zhAnswer
        ? '英译中'
        : '逐句翻译'
      : hasTargets
        ? prompt.targets.map((t) => t.text).join(' / ')
        : mode === 'full'
          ? '随机主题'
          : '主题翻译',
  }
}

export function buildProductionFeedbackPrompt(
  task: ProductionTask,
  answer: string,
  previousIssues?: readonly Pick<WritingIssue, 'original' | 'suggestion' | 'reason' | 'rule' | 'key'>[],
): string {
  const base = buildWritingFeedbackPrompt(task, answer, previousIssues ? { previousIssues } : {})
  if (task.answerLang !== 'zh') return base
  return [
    '注意：本题是「英译中」，学生作答是中文。请按中文表达批改，不要按英文语法规则扣分；',
    'issues.original / suggestion / reason 也用中文；problem 应是中文不自然、漏译、加戏或和参考译文差距大的地方。',
    '仍然只输出同样的 v2 JSON。',
    '',
    base,
  ].join('\n')
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

