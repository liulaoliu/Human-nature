/**
 * AI 工作包的读写：导出包的结构说明、结果包的宽容解析、稳定 job id。
 *
 * 只做「JSON ⇄ 对象」这一层，不推导待办、不拼提示词。
 * 所有入口都对脏数据宽容：服务端版本漂移 / 代理返回异常时，不能让坏结果
 * 直接进 `applyTaskResult`（那里第一行就是 `raw.trim()`）。
 */
import {
  isAiJobTask,
  type AiJob,
  type AiJobPack,
  type AiResultEntry,
  AI_JOB_PACK_VERSION,
} from './aiJobTypes'

/**
 * 运行时校验一批 AI 结果。返回能用的条目 + 丢弃数；非数组整体丢弃（缺省 = 0 条）。
 */
export function normalizeAiResults(raw: unknown): { results: AiResultEntry[]; dropped: number } {
  if (!Array.isArray(raw)) return { results: [], dropped: raw == null ? 0 : 1 }
  const results: AiResultEntry[] = []
  let dropped = 0
  for (const it of raw) {
    if (!it || typeof it !== 'object') {
      dropped++
      continue
    }
    const rec = it as Record<string, unknown>
    const rawText =
      typeof rec.raw === 'string'
        ? rec.raw
        : typeof rec.text === 'string'
          ? rec.text
          : typeof rec.content === 'string'
            ? rec.content
            : ''
    if (!rawText.trim()) {
      dropped++
      continue
    }
    const entry: AiResultEntry = {
      id: typeof rec.id === 'string' ? rec.id : '',
      raw: rawText,
    }
    if (isAiJobTask(rec.task)) entry.task = rec.task
    if (Array.isArray(rec.askedWords)) entry.askedWords = rec.askedWords.filter((w): w is string => typeof w === 'string')
    if (Array.isArray(rec.askedIds)) entry.askedIds = rec.askedIds.filter((w): w is string => typeof w === 'string')
    results.push(entry)
  }
  return { results, dropped }
}

/** 稳定短哈希（FNV-1a → base36），用于由内容生成任务 id。 */
function fnv1a(s: string): string {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619)
  return (h >>> 0).toString(36)
}

/**
 * 由「任务 + 内容指纹」生成**稳定** id：同一逻辑任务（同样的词/句）重建后 id 不变，
 * 这样网页版进度（按 id 记 done）才能跨刷新 / 数据变动保持。
 */
export function makeJobId(task: AiJob['task'], key: string): string {
  return `${task}-${fnv1a(key)}`
}

/**
 * 导出包里附带的「结果格式说明」。给本机 agent / 任意 AI 看：照它做就能直接产出
 * 可导入的 `ai-results` 包，不用再猜格式。
 */
export const AI_RESULT_FORMAT_INSTRUCTIONS = [
  '你是「学吧老哥」的 AI 批处理引擎。下面 jobs 数组里每个元素是一条独立任务：请阅读它的 prompt 并作答。',
  '把**所有回答**包成**一个**结果 JSON，并且**只输出这个 JSON**（不要解释、不要 Markdown 代码围栏）：',
  '',
  '{',
  '  "version": 1,',
  '  "results": [',
  '    { "id": "<job 的 id，原样照抄>", "task": "<job 的 task>", "raw": "<该 job 的回答文本>" }',
  '  ]',
  '}',
  '',
  '规则：',
  '1. 每个 job 对应一条 result；id 必须与 jobs[].id 完全一致（导入靠它匹配，错了会被跳过）。',
  '2. raw 是字符串：内容本身若是 JSON / 表格，照原样放进去（转义进字符串）。',
  '3. 一次放不下就宁可少答几个、之后再补，绝不省略或用省略号。',
  '4. 不要复述任务、不要总结；只输出上面的结果 JSON。',
].join('\n')

export function buildJobPack(jobs: AiJob[], now: Date = new Date()): AiJobPack {
  return {
    version: AI_JOB_PACK_VERSION,
    exportedAt: now.toISOString(),
    instructions: AI_RESULT_FORMAT_INSTRUCTIONS,
    jobs,
  }
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

  const { results } = normalizeAiResults(arr)
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
