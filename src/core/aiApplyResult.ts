import { isAiJobTask, type AiJob, type AiJobTask, type AiResultEntry } from './aiJobTypes'

/** 把 AI 结果逐条应用到任务上；返回收尾报告需要的数据。 */
export interface ApplyAiTaskResult {
  (task: AiJobTask | null, raw: string, askedWords: string[], askedIds: string[], meta?: { articleKey?: string }): {
    report: string[]
    ok: boolean
  }
}

export interface AiApplySummary {
  okCount: number
  failCount: number
  lines: string[]
  appliedIds: string[]
  /** 本次是否成功应用了「自动标词」（调用方据此记本篇完成标记）。 */
  autoVocab: boolean
}

/**
 * 结果应用的纯编排：按 id 找回任务、调用注入的 apply 回调、统计成功/失败。
 *
 * 不碰 React / localStorage；`useAiPack` 只负责把 `autoVocab` 映射成持久化标记。
 */
export function applyAiResults(
  results: readonly AiResultEntry[],
  jobs: readonly AiJob[],
  applyTaskResult: ApplyAiTaskResult,
): AiApplySummary {
  const byId = new Map(jobs.map((j) => [j.id, j]))
  const lines: string[] = []
  const appliedIds: string[] = []
  let okCount = 0
  let failCount = 0
  let autoVocab = false

  for (const r of results) {
    const job = r.id ? byId.get(r.id) : undefined
    const task = job?.task ?? (isAiJobTask(r.task) ? r.task : null)
    if (!task) {
      lines.push(`跳过：找不到任务（id=${r.id || '无'}）`)
      failCount++
      continue
    }
    const res = applyTaskResult(
      task,
      r.raw,
      job?.askedWords ?? r.askedWords ?? [],
      job?.askedIds ?? r.askedIds ?? [],
      job?.articleKey ? { articleKey: job.articleKey } : undefined,
    )
    if (res.ok) {
      okCount++
      if (job) {
        appliedIds.push(job.id)
        if (job.task === 'auto_vocab') autoVocab = true
      }
    } else {
      failCount++
    }
    lines.push(`【${job?.label ?? task}】${res.report[0] ?? (res.ok ? '已应用' : '未解析')}`)
  }

  return { okCount, failCount, lines, appliedIds, autoVocab }
}
