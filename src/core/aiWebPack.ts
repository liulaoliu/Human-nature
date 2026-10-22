/**
 * 网页版 AI 的打包与回读。
 *
 * 网页版和本机 agent 不一样：它不知道我们是谁、要什么格式，也容易截断/漏答。
 * 所以这里显式说明任务数、逐题分隔符，并把回复按分隔符切回一条条结果。
 * 只处理「提示词文本 ⇄ 结果条目」，不推导待办、不应用结果。
 */
import { parseAiResultPack } from './aiPackIO'
import type { AiJob, AiResultEntry } from './aiJobTypes'

/** 网页版结果里，每个任务的答案用这行开头。 */
export const WEB_ANSWER_TAG = '@@@ANSWER'
/** 网页版结果里，每个任务的答案用这行结束（可省略）。 */
export const WEB_END_TAG = '@@@END'

/**
 * 把若干待办拼成**一条**可直接发给网页版 AI（chat.deepseek.com 等）的提示词。
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
