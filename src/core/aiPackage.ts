/**
 * AI 工作包：把「复制提示词 → 贴到网页版 AI → 把结果粘回来」这一串手工活，
 * 打成一个文件整包交给 AI（或本机 agent），再把结果文件导回，一次应用全部。
 *
 * 这里只放**不依赖 DOM / React 的纯逻辑**：类型、打包、解析、分块，以及
 * 「由当前数据推导出所有待办」的 `buildAiJobs`。
 * 具体的解析与应用（apply*）仍在 ReaderApp 里组装。
 */
import {
  buildBatchLookupPrompt,
  buildConfusablePrompt,
  buildLemmaPrompt,
  buildPosPrompt,
  buildTranslateAllPrompt,
} from './analyzer'
import { buildLanguagePrompt } from './language'
import { buildListeningQuizPrompt } from './listening'
import type { Sentence, VocabItem } from '../types/document'

/** 可以打包的 AI 任务类型（与 ReaderApp 的 lastTask 对齐）。 */
export const AI_JOB_TASKS = [
  'lookup',
  'translate',
  'auto_vocab',
  'confusable',
  'lemma',
  'pos',
  'listening',
  'language',
  'imitation',
  'feedback',
] as const

export type AiJobTask = (typeof AI_JOB_TASKS)[number]

export function isAiJobTask(value: unknown): value is AiJobTask {
  return typeof value === 'string' && (AI_JOB_TASKS as readonly string[]).includes(value)
}

/** 工作包里的一个待办：一条提示词 + 应用它时需要的上下文（问过哪些词/句）。 */
export interface AiJob {
  id: string
  task: AiJobTask
  /** 人看的一行说明，例如「生成混淆项（60）」。 */
  label: string
  /** 回执里用于判断「AI 没返回哪些」的词。 */
  askedWords: string[]
  /** 同上，句子 id（翻译 / 语言点）。 */
  askedIds: string[]
  /** 要原样发给 AI 的完整提示词。 */
  prompt: string
}

export interface AiJobPack {
  version: 1
  exportedAt: string
  jobs: AiJob[]
}

/** AI 返回包里的单条结果：按 id 对应一个 job，raw 是 AI 的原始返回文本。 */
export interface AiResultEntry {
  id: string
  /** 可选：id 对不上时兜底用任务类型。 */
  task?: AiJobTask
  /** 可选：id 对不上时兜底用（一般是 job 的 askedWords / askedIds）。 */
  askedWords?: string[]
  askedIds?: string[]
  raw: string
}

export const AI_JOB_PACK_VERSION = 1

export function makeJobId(task: AiJobTask, seq: number): string {
  return `${task}-${seq}`
}

export function buildJobPack(jobs: AiJob[], now: Date = new Date()): AiJobPack {
  return { version: AI_JOB_PACK_VERSION, exportedAt: now.toISOString(), jobs }
}

/** 把数组切成每块最多 size 个（size<=0 表示不切）。 */
export function chunk<T>(items: T[], size: number): T[][] {
  if (size <= 0) return items.length ? [items] : []
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
  return out
}

/**
 * 解析 AI 结果文件。宽容三种写法：
 *   { results: [{ id, raw, ... }] }
 *   [{ id, raw }]
 *   { id, raw }            // 只有一条时
 * 只保留有非空 raw 的条目；`task`/`askedWords`/`askedIds` 可选。
 */
export function parseAiResultPack(text: string): { results: AiResultEntry[]; error: string } {
  let obj: unknown
  try {
    obj = JSON.parse(text)
  } catch {
    return { results: [], error: '不是合法 JSON' }
  }

  let arr: unknown[] | null = null
  if (Array.isArray(obj)) arr = obj
  else if (obj && typeof obj === 'object') {
    const results = (obj as { results?: unknown }).results
    if (Array.isArray(results)) arr = results
    else if ('raw' in (obj as object)) arr = [obj] // 单条对象
  }
  if (!arr) return { results: [], error: '缺少 results 数组' }

  const results: AiResultEntry[] = []
  for (const it of arr) {
    if (!it || typeof it !== 'object') continue
    const rec = it as Record<string, unknown>
    const raw =
      typeof rec.raw === 'string'
        ? rec.raw
        : typeof rec.text === 'string'
          ? rec.text
          : typeof rec.content === 'string'
            ? rec.content
            : ''
    if (!raw.trim()) continue
    const entry: AiResultEntry = {
      id: typeof rec.id === 'string' ? rec.id : '',
      raw,
    }
    if (isAiJobTask(rec.task)) entry.task = rec.task
    if (Array.isArray(rec.askedWords)) entry.askedWords = rec.askedWords.filter((w): w is string => typeof w === 'string')
    if (Array.isArray(rec.askedIds)) entry.askedIds = rec.askedIds.filter((w): w is string => typeof w === 'string')
    results.push(entry)
  }
  if (!results.length) return { results: [], error: '没有有效的 raw 文本' }
  return { results, error: '' }
}

/** 解析已导出的工作包（用于导入结果时按 id 找 askedWords/askedIds）。 */
export function parseJobPack(text: string): AiJobPack | null {
  try {
    const obj = JSON.parse(text) as {
      version?: unknown
      exportedAt?: unknown
      jobs?: unknown
    }
    if (!obj || !Array.isArray(obj.jobs)) return null
    const jobs: AiJob[] = []
    for (const it of obj.jobs) {
      if (!it || typeof it !== 'object') continue
      const rec = it as Record<string, unknown>
      if (typeof rec.id !== 'string' || !isAiJobTask(rec.task)) continue
      jobs.push({
        id: rec.id,
        task: rec.task,
        label: typeof rec.label === 'string' ? rec.label : rec.task,
        askedWords: Array.isArray(rec.askedWords) ? rec.askedWords.filter((w): w is string => typeof w === 'string') : [],
        askedIds: Array.isArray(rec.askedIds) ? rec.askedIds.filter((w): w is string => typeof w === 'string') : [],
        prompt: typeof rec.prompt === 'string' ? rec.prompt : '',
      })
    }
    if (!jobs.length) return null
    return { version: 1, exportedAt: typeof obj.exportedAt === 'string' ? obj.exportedAt : '', jobs }
  } catch {
    return null
  }
}

/** 推导 AI 待办所需的当前数据（全部只读，便于单测）。 */
export interface AiJobsInput {
  /** 待选清单（选词模式攒的）。 */
  batch: { word: string; sentence?: string }[]
  /** 整个词库。 */
  items: VocabItem[]
  /** 缺混淆项、已入库的词。 */
  confusableTodo: VocabItem[]
  /** 每次生成混淆项的批量大小（0=全部）。 */
  confusableBatchSize: number
  /** 疑似非原型、待校正的词。 */
  lemmaCandidates: VocabItem[]
  /** 含 -ing/-ed、待辨析的词。 */
  posCandidates: VocabItem[]
  /** 当前文章的句子。 */
  sentences: Sentence[]
  /** 是否已有听力理解题。 */
  hasListenQuiz: boolean
  /** 听力题数量。 */
  listenCount: number
}

const LOOKUP_CHUNK = 30
/** 翻译 / 语言点每次带多少句（一条太长会在网页端被截断）。 */
const SENTENCE_CHUNK = 6

/**
 * 由当前数据推导出所有「待办」：每条 = 一条完整提示词 + 应用时需要的上下文。
 * 覆盖：待选查词 / 补音标释义 / 混淆项 / 原形 / -ing-ed / 翻译 / 语言点 / 听力。
 * 仿写与批改是交互式的（依赖用户当下写的内容），不打包。
 */
export function buildAiJobs(input: AiJobsInput): AiJob[] {
  const jobs: AiJob[] = []
  let seq = 0
  const push = (
    task: AiJobTask,
    label: string,
    prompt: string,
    askedWords: string[] = [],
    askedIds: string[] = [],
  ) => {
    jobs.push({ id: makeJobId(task, ++seq), task, label, askedWords, askedIds, prompt })
  }

  // 待选清单 → 批量查词
  if (input.batch.length) {
    push(
      'lookup',
      `批量查词（待选 ${input.batch.length}）`,
      buildBatchLookupPrompt(input.batch.map((b) => ({ word: b.word, context: b.sentence }))),
      input.batch.map((b) => b.word),
    )
  }
  // 生词本缺音标/释义 → 批量查词（每 N 个一份，避免 AI 回复被截断）
  const needInfo = input.items.filter((it) => !it.phonetic || !it.meaning)
  for (const part of chunk(needInfo, LOOKUP_CHUNK)) {
    push(
      'lookup',
      `补齐音标/释义（${part.length}）`,
      buildBatchLookupPrompt(part.map((it) => ({ word: it.word, context: it.source?.sentenceText }))),
      part.map((it) => it.word),
    )
  }
  // 缺混淆项 → 生成混淆项（按设置分批）
  const confSize = input.confusableBatchSize > 0 ? input.confusableBatchSize : input.confusableTodo.length || 1
  for (const part of chunk(input.confusableTodo, confSize)) {
    push(
      'confusable',
      `生成混淆项（${part.length}）`,
      buildConfusablePrompt(part.map((it) => ({ word: it.word, meaning: it.meaning }))),
      part.map((it) => it.word),
    )
  }
  // 疑似非原型 → 校正原形
  if (input.lemmaCandidates.length) {
    push(
      'lemma',
      `校正原形（${input.lemmaCandidates.length}）`,
      buildLemmaPrompt(input.lemmaCandidates.map((it) => ({ word: it.word, context: it.source?.sentenceText }))),
      input.lemmaCandidates.map((it) => it.word),
    )
  }
  // -ing/-ed → 语法辨析
  if (input.posCandidates.length) {
    push(
      'pos',
      `-ing/-ed 辨析（${input.posCandidates.length}）`,
      buildPosPrompt(input.posCandidates.map((it) => ({ word: it.word, context: it.source?.sentenceText }))),
      input.posCandidates.map((it) => it.word),
    )
  }
  // 缺译文 → 全文翻译（按句分块：一条塞几十句最容易在网页端被截断）
  const noTrans = input.sentences.filter((s) => !s.translation)
  let tPos = 0
  for (const part of chunk(noTrans, SENTENCE_CHUNK)) {
    const from = tPos + 1
    tPos += part.length
    push(
      'translate',
      `翻译（第 ${from}-${tPos} 句）`,
      buildTranslateAllPrompt(part.map((s) => ({ id: s.id, text: s.text }))),
      [],
      part.map((s) => s.id),
    )
  }
  // 缺语言点 → 逐句语言点（同样按句分块）
  const noLang = input.sentences.filter((s) => !s.language)
  let lPos = 0
  for (const part of chunk(noLang, SENTENCE_CHUNK)) {
    const from = lPos + 1
    lPos += part.length
    push(
      'language',
      `语言点（第 ${from}-${lPos} 句）`,
      buildLanguagePrompt(part.map((s) => ({ id: s.id, text: s.text }))),
      [],
      part.map((s) => s.id),
    )
  }
  // 没有听力题 → 生成听力理解题
  if (input.sentences.length && !input.hasListenQuiz) {
    push(
      'listening',
      `听力理解题（${input.listenCount} 题）`,
      buildListeningQuizPrompt(input.sentences.map((s) => s.text).join(' '), { count: input.listenCount }),
    )
  }
  return jobs
}

/** 网页版结果里，每个任务的答案用这行开头。 */
export const WEB_ANSWER_TAG = '@@@ANSWER'
/** 网页版结果里，每个任务的答案用这行结束（可省略）。 */
export const WEB_END_TAG = '@@@END'

/**
 * 把若干待办拼成**一条**可直接发给网页版 AI（chat.deepseek.com 等）的提示词。
 *
 * 网页版和本机 agent 不一样：它不知道我们是谁、要什么格式，也容易截断/漏答。
 * 所以这里显式说明：任务数、逐个作答、固定分隔符、宁可分批也别省略。
 */
export function buildWebPackPrompt(
  jobs: AiJob[],
  meta?: { batchIndex?: number; batchCount?: number; remaining?: number },
): string {
  const head: string[] = []
  head.push('你是英语学习工具「学吧老哥」的批处理引擎。')
  if (meta && meta.batchCount && meta.batchCount > 1) {
    head.push(
      `现在给你**第 ${meta.batchIndex} / ${meta.batchCount} 批**共 ${jobs.length} 个任务（每个任务是一段已经写好的提示词）。只处理本批。`,
    )
  } else {
    head.push(`现在给你共 ${jobs.length} 个任务（每个任务是一段已经写好的提示词）。`)
  }
  head.push('请**逐个**作答，严格按下面的格式输出：')
  head.push('')
  head.push(`${WEB_ANSWER_TAG} 任务id`)
  head.push('（这个任务的答案，按它自己的要求输出）')
  head.push(WEB_END_TAG)
  head.push('')
  head.push('规则：')
  head.push('1. 每个任务一行 `' + WEB_ANSWER_TAG + ' 它的id` 开头，`' + WEB_END_TAG + '` 结尾；id 原样照抄，不要改、不要漏。')
  head.push('2. 只输出答案本身，不要开场白、不要总结、不要合并多个任务。')
  head.push('3. 内容太多放不下时，**宁可这次少答几个**，也绝对不要省略或省略号；我会再问没答完的。')
  head.push('')
  head.push('===== 任务开始 =====')

  const body = jobs.map((j) => {
    return `\n----- 任务 ${j.id}（${j.task} · ${j.label}）-----\n${j.prompt.trim()}`
  })
  head.push(body.join('\n'))
  head.push('\n===== 任务结束 =====')
  if (meta && meta.remaining && meta.remaining > 0) {
    head.push(`（本批之外还有 ${meta.remaining} 个任务，先不用管。）`)
  }
  return head.join('\n')
}

/** 去掉答案两端的代码围栏 ```。 */
function stripFence(s: string): string {
  const t = s.trim()
  const m = t.match(/^```[a-zA-Z]*\s*\n([\s\S]*?)\n```$/)
  return (m ? m[1] : t).trim()
}

/**
 * 解析网页版 AI 的回复（可能被截断、可能带围栏/废话）。
 * 优先按 `@@@ANSWER <id>` 分隔符切；没有则退回严格 JSON（results 数组）。
 * 只返回解析出答案的条目；缺失的 id 由调用方与任务列表比对。
 */
export function parseWebPackResults(text: string): AiResultEntry[] {
  const src = text.replace(/\r\n/g, '\n')
  // 收集所有 “@@@ANSWER <id>” 标记行的位置
  const re = /^[ \t>*-]*@@@\s*ANSWER\s+([A-Za-z0-9_-]+)[^\n]*$/gim
  const marks: { id: string; from: number; markerStart: number }[] = []
  let m: RegExpExecArray | null
  while ((m = re.exec(src))) {
    marks.push({ id: m[1], from: m.index + m[0].length, markerStart: m.index })
  }
  if (marks.length) {
    const out: AiResultEntry[] = []
    for (let i = 0; i < marks.length; i++) {
      const from = marks[i].from
      const to = i + 1 < marks.length ? marks[i + 1].markerStart : src.length
      let raw = src.slice(from, to)
      // 去掉结尾的 @@@END（可能后面还有换行）
      raw = raw.replace(/[ \t]*@@@\s*END[ \t]*\s*$/i, '')
      raw = stripFence(raw)
      if (raw.trim()) out.push({ id: marks[i].id, raw })
    }
    if (out.length) return out
  }
  // 退回严格 JSON
  return parseAiResultPack(text).results
}

/** 任务里哪些 id 没在结果里出现（网页端截断时用）。 */
export function missingJobIds(jobs: AiJob[], results: { id: string }[]): string[] {
  const got = new Set(results.map((r) => r.id))
  return jobs.filter((j) => !got.has(j.id)).map((j) => j.id)
}

/** 待办任务数（只数，不生成提示词，便宜）。 */
export function countAiJobs(input: AiJobsInput): number {
  let n = 0
  if (input.batch.length) n++
  n += chunk(
    input.items.filter((it) => !it.phonetic || !it.meaning),
    LOOKUP_CHUNK,
  ).length
  n += chunk(
    input.confusableTodo,
    input.confusableBatchSize > 0 ? input.confusableBatchSize : input.confusableTodo.length || 1,
  ).length
  if (input.lemmaCandidates.length) n++
  if (input.posCandidates.length) n++
  n += chunk(
    input.sentences.filter((s) => !s.translation),
    SENTENCE_CHUNK,
  ).length
  n += chunk(
    input.sentences.filter((s) => !s.language),
    SENTENCE_CHUNK,
  ).length
  if (input.sentences.length && !input.hasListenQuiz) n++
  return n
}
