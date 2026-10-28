import { goldenDrillKey, goldenTargetsFor, type GoldenTextMeta } from './golden'
import type { GoldenDrillRecord } from './goldenProgress'
import { buildWritingFeedbackPrompt, type ImitationTask } from './writing'
import type { GoldenExamItem, GoldenLesson } from '../types/document'

/**
 * D老师小课堂的仿写考试：用学过的句型 + 中文提示写新句子。
 *
 * 纯逻辑层只负责三件事：
 *   1. 从已完成句子里生成本地题（AI 不可用时也能考）；
 *   2. 校验 AI 返回的题（句子 id / 范句 / 必须用词都必须落在原文里）；
 *   3. 把题转成现有仿写批改的 `ImitationTask`，复用批改提示词与解析。
 *
 * 成绩不在这里存：沿用 `WritingRecord`（source='goldenExam'），备份/迁移自然兼容。
 */

export const GOLDEN_EXAM_AFTER = 5
export const GOLDEN_EXAM_LIMIT = 10

export function goldenExamAfter(lesson: GoldenLesson | null | undefined): 5 | 10 {
  return lesson?.options?.examAfter === 10 ? 10 : 5
}

function isObject(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v)
}

function str(v: unknown): string {
  return typeof v === 'string' ? v.trim() : ''
}

function strList(v: unknown): string[] {
  return Array.isArray(v) ? v.map(str).filter(Boolean) : []
}

function num(v: unknown): number {
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? n : 0
}

/** 按文章 + 句子生成稳定 id；同一句内容变了，旧题仍会被 normalize 的范句校验淘汰。 */
export function goldenExamItemId(sentenceId: string): string {
  return `exam:${sentenceId}`
}

const DEFAULT_RUBRIC: GoldenExamItem['rubric'] = [
  { dimension: '结构运用', weight: 35, description: '目标句型 / 时态 / 语态是否准确迁移' },
  { dimension: '用词搭配', weight: 25, description: '必须使用的词块与固定搭配是否自然' },
  { dimension: '语法准确', weight: 25, description: '主谓一致、冠词、介词、单复数等硬错误' },
  { dimension: '意思与连贯', weight: 15, description: '中文提示是否写清楚，句子是否连贯' },
]

function localTask(content: GoldenLesson['sentences'][number], sentence: GoldenTextMeta): string {
  const zh = content.zh || sentence.translation || ''
  const structure = content.pattern || content.tense || ''
  const parts = [
    '用学过的句型仿写一句英文（不要逐字照抄范句，换一个主语或场景）。',
    structure ? `目标结构：${structure}。` : '',
    zh ? `中文参考：${zh}。` : '',
  ]
  return parts.filter(Boolean).join(' ')
}

function makeLocalItem(
  content: GoldenLesson['sentences'][number],
  sentence: GoldenTextMeta,
): GoldenExamItem {
  const structure = content.pattern || content.tense || undefined
  const mustUse = content.targets.map((t) => t.en).filter(Boolean).slice(0, 6)
  return {
    id: goldenExamItemId(sentence.id),
    sentenceId: sentence.id,
    task: localTask(content, sentence),
    model: sentence.text,
    ...(structure ? { structure } : {}),
    mustUse,
    rubric: DEFAULT_RUBRIC,
    source: 'local',
  }
}

function examRecords(
  lesson: GoldenLesson,
  sentences: GoldenTextMeta[],
  records: GoldenDrillRecord[],
  articleId: string,
): Set<string> {
  const byId = new Map(sentences.map((s) => [s.id, s]))
  const out = new Set<string>()
  for (const content of lesson.sentences) {
    if (!lesson.selected.length ? false : !lesson.selected.includes(content.id)) continue
    const sentence = byId.get(content.id)
    if (!sentence) continue
    const key = goldenDrillKey(sentence.text, goldenTargetsFor(lesson, content.id))
    const rec = records.find(
      (r) => r.articleId === articleId && r.sentenceId === content.id && r.drillKey === key,
    )
    if (rec?.summarySeen) out.add(content.id)
  }
  return out
}

/** 已完成「填空 + 拼句 + 小结」的句子数；门槛按这个算，不要求先做完逆向回顾。 */
export function goldenExamCompletedIds(
  lesson: GoldenLesson,
  sentences: GoldenTextMeta[],
  records: GoldenDrillRecord[],
  articleId: string,
): string[] {
  return [...examRecords(lesson, sentences, records, articleId)]
}

export function goldenExamUnlocked(
  lesson: GoldenLesson,
  sentences: GoldenTextMeta[],
  records: GoldenDrillRecord[],
  articleId: string,
): boolean {
  return goldenExamCompletedIds(lesson, sentences, records, articleId).length >= goldenExamAfter(lesson)
}

/** 本地出题：只取已完成句子，按课程顺序，最多 10 题。 */
export function buildLocalGoldenExam(
  lesson: GoldenLesson,
  sentences: GoldenTextMeta[],
  records: GoldenDrillRecord[],
  articleId: string,
  limit = GOLDEN_EXAM_LIMIT,
): GoldenExamItem[] {
  const done = examRecords(lesson, sentences, records, articleId)
  const byId = new Map(sentences.map((s) => [s.id, s]))
  const content = new Map(lesson.sentences.map((s) => [s.id, s]))
  const ids = lesson.selected.length ? lesson.selected : lesson.sentences.map((s) => s.id)
  return ids
    .filter((id) => done.has(id))
    .map((id) => {
      const c = content.get(id)
      const s = byId.get(id)
      return c && s ? makeLocalItem(c, s) : null
    })
    .filter((x): x is GoldenExamItem => !!x)
    .slice(0, Math.max(0, limit))
}

export interface GoldenExamPromptSentence {
  id: string
  text: string
  translation?: string | null
  pattern?: string
  tense?: string
  targets: string[]
}

/** AI 出题提示词：只让 AI 出中文题干 + 必须用词，不重写范句。 */
export function buildGoldenExamPrompt(input: { title?: string; sentences: GoldenExamPromptSentence[] }): string {
  const lines = input.sentences.map((s) => {
    const tr = s.translation?.trim() ? `\t译：${s.translation.trim()}` : ''
    const structure = s.pattern?.trim() || s.tense?.trim() || ''
    return `${s.id}\t${s.text}${tr}${structure ? `\t结构：${structure}` : ''}\t词块：${s.targets.join('、')}`
  })
  return [
    '你是英语写作教练。下面这些句子是学生已经学过的；请为每句出一道「仿写考试题」。',
    '',
    '出题要求：',
    '- sentenceId 原样照抄句子编号；',
    '- task：中文题干，给出一个**新的情境/主语/内容**，让学生套用该句结构写英文；不要只让学生逐字翻译原句；',
    '- structure：一句话点出要迁移的句型 / 时态 / 语态；',
    '- mustUse：必须用上的已学词块（从输入词块里挑 2–4 个，必须是范句里逐字出现的片段）；',
    '- rubric：3–4 个评分维度，权重加起来 100（结构 / 用词 / 语法 / 意思）；',
    '- 不要改写范句，不要输出参考英文答案。',
    '',
    '只输出一个 JSON 对象，不要 Markdown、不要解释：',
    '{"items":[{"sentenceId":"s1","task":"...","structure":"...","mustUse":["..."],"rubric":[{"dimension":"结构运用","weight":35,"description":"..."}]}]}',
    '',
    input.title ? `文章标题：${input.title}` : '',
    '句子（id\t原文\t译文\t结构\t词块）：',
    ...lines,
  ]
    .filter(Boolean)
    .join('\n')
}

function stripFence(raw: string): string {
  const m = raw.match(/```(?:json)?\s*([\s\S]*?)```/i)
  return (m ? m[1] : raw).trim()
}

function extractJson(raw: string): unknown {
  const text = stripFence(raw)
  if (!text) return null
  try {
    return JSON.parse(text)
  } catch {
    const start = Math.min(...[text.indexOf('{'), text.indexOf('[')].filter((i) => i >= 0))
    if (!Number.isFinite(start)) return null
    const open = text[start]
    const close = open === '{' ? '}' : ']'
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
      else if (c === open) depth++
      else if (c === close) {
        depth--
        if (depth === 0) {
          try {
            return JSON.parse(text.slice(start, i + 1))
          } catch {
            return null
          }
        }
      }
    }
    return null
  }
}

/** AI / 备份 / 手改数据 → 可用的考试题；范句对不上、题面为空的条目直接丢弃。 */
export function normalizeGoldenExam(
  raw: unknown,
  sentences: GoldenTextMeta[],
  source: 'local' | 'ai' = 'ai',
): GoldenExamItem[] {
  const list = Array.isArray(raw)
    ? raw
    : isObject(raw) && Array.isArray(raw.items)
      ? raw.items
      : isObject(raw) && Array.isArray(raw.exam)
        ? raw.exam
        : []
  const byId = new Map(sentences.map((s) => [s.id, s]))
  const out: GoldenExamItem[] = []
  const seen = new Set<string>()
  for (const item of list) {
    if (!isObject(item)) continue
    const sentenceId = str(item.sentenceId) || str(item.id)
    const sentence = byId.get(sentenceId)
    if (!sentence || seen.has(sentenceId)) continue
    const task = str(item.task)
    if (!task) continue
    const model = sentence.text
    const mustUse = strList(item.mustUse).filter((x) => model.toLowerCase().includes(x.toLowerCase()))
    const rubric: GoldenExamItem['rubric'] = []
    for (const r of Array.isArray(item.rubric) ? item.rubric : []) {
      if (!isObject(r)) continue
      const dimension = str(r.dimension)
      if (!dimension) continue
      const weight = Math.max(0, Math.min(100, num(r.weight)))
      rubric.push({ dimension, weight, ...(str(r.description) ? { description: str(r.description) } : {}) })
    }
    seen.add(sentenceId)
    out.push({
      id: str(item.id) || goldenExamItemId(sentenceId),
      sentenceId,
      task,
      model,
      ...(str(item.structure) ? { structure: str(item.structure) } : {}),
      mustUse,
      rubric: rubric.length ? rubric : DEFAULT_RUBRIC,
      source: item.source === 'local' ? 'local' : source,
    })
  }
  return out
}

export function parseGoldenExam(raw: string, sentences: GoldenTextMeta[]): GoldenExamItem[] {
  const obj = extractJson(raw)
  if (!obj) return []
  return normalizeGoldenExam(obj, sentences, 'ai')
}

/** 转成现有仿写批改任务；题目、范句、必须用词都复用同一套结构。 */
export function examToImitation(item: GoldenExamItem): ImitationTask {
  return {
    task: item.task,
    model: item.model,
    ...(item.structure ? { structure: item.structure } : {}),
    mustUse: [...item.mustUse],
    rubric: item.rubric.map((r) => ({ ...r })),
  }
}

/** 批改提示词：语义上就是“仿写批改”，直接复用核心提示词，避免第二套口径。 */
export function buildGoldenExamFeedbackPrompt(item: GoldenExamItem, answer: string): string {
  return buildWritingFeedbackPrompt(examToImitation(item), answer)
}

/** 防止重复的旧考试记录被当成普通仿写历史：调用方按这个筛选。 */
export function isGoldenExamRecord(rec: { source?: string }): boolean {
  return rec.source === 'goldenExam'
}

/** 只保留还存在的句子；改正文/重新选句后旧题自动淘汰。 */
export function pruneGoldenExam(items: GoldenExamItem[] | undefined, sentences: GoldenTextMeta[]): GoldenExamItem[] | undefined {
  if (!items?.length) return undefined
  const byId = new Map(sentences.map((s) => [s.id, s]))
  const next = items.filter((item) => {
    const s = byId.get(item.sentenceId)
    return !!s && s.text === item.model
  })
  return next.length ? next : undefined
}

/** 供 AI 出题时从已完成句子收集输入；targets 用课程里的词块。 */
export function goldenExamPromptSentences(
  lesson: GoldenLesson,
  sentences: GoldenTextMeta[],
  records: GoldenDrillRecord[],
  articleId: string,
): GoldenExamPromptSentence[] {
  const done = examRecords(lesson, sentences, records, articleId)
  const byId = new Map(sentences.map((s) => [s.id, s]))
  const content = new Map(lesson.sentences.map((s) => [s.id, s]))
  const ids = lesson.selected.length ? lesson.selected : lesson.sentences.map((s) => s.id)
  const out: GoldenExamPromptSentence[] = []
  for (const id of ids) {
    if (!done.has(id)) continue
    const s = byId.get(id)
    const c = content.get(id)
    if (!s || !c) continue
    out.push({
      id,
      text: s.text,
      ...(s.translation ? { translation: s.translation } : {}),
      ...(c.pattern ? { pattern: c.pattern } : {}),
      ...(c.tense ? { tense: c.tense } : {}),
      targets: c.targets.map((t) => t.en),
    })
  }
  return out
}


