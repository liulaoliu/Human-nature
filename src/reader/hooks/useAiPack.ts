import { useCallback, useMemo, useRef, useState, type ChangeEvent } from 'react'
import {
  AI_TASK_LABEL,
  buildAiJobs,
  buildJobPack,
  buildWebPackPrompt,
  countAiJobs,
  isAiJobTask,
  missingJobIds,
  parseAiResultPack,
  parseJobPack,
  parseWebPackResults,
} from '../../core/aiPackage'
import type { AiJob, AiJobTask, AiJobsInput, AiResultEntry } from '../../core/aiPackage'
import { dayKeyLocal } from '../../core/activity'
import { useLocalStorageState } from './useLocalStorageState'

export interface UseAiPackParams {
  jobsInput: AiJobsInput
  applyTaskResult: (
    task: AiJobTask | null,
    raw: string,
    askedWords: string[],
    askedIds: string[],
  ) => { report: string[]; ok: boolean }
  download: (name: string, content: string, mime: string) => void
  flash: (message: string) => void
  onReport: (lines: string[]) => void
}

/**
 * AI 工作包：把「复制提示词 → AI → 粘回」变成批量流程。
 *
 * 两条路：
 *  - 本机 agent：导出 `ai-jobs-*.json` → 喂给 agent → 结果 JSON 导回；
 *  - 网页版（DeepSeek 等）：复制一条「工作包提示词」去网页贴 → 整段回复贴回 → 应用；
 *    网页端可能截断/漏答，所以按「待处理」分批复制、跟踪进度（完成/缺项），并支持刷新。
 */
export function useAiPack({ jobsInput, applyTaskResult, download, flash, onReport }: UseAiPackParams) {
  const packRef = useRef<string>('')
  const fileRef = useRef<HTMLInputElement | null>(null)
  /** 网页版每批任务数（0=全部一批）。 */
  const [webBatchSize, setWebBatchSize] = useState(6)
  /** 网页版进度：已复制过、已成功应用的任务 id（持久化，刷新不丢）。 */
  const [askedIds, setAskedIds] = useLocalStorageState<string[]>('reader:aiWebAsked', [])
  const [doneIds, setDoneIds] = useLocalStorageState<string[]>('reader:aiWebDone', [])
  /** agent 路径回执里缺的词（用于「复制未返回的」重试）。 */
  const [missingIds, setMissingIds] = useState<string[]>([])

  /** 当前待办（顺序稳定，id 可复现）。 */
  const round = useMemo(() => buildAiJobs(jobsInput), [jobsInput])
  const jobCount = useMemo(() => countAiJobs(jobsInput), [jobsInput])

  const roundIdSet = useMemo(() => new Set(round.map((j) => j.id)), [round])
  const doneSet = useMemo(() => new Set(doneIds.filter((id) => roundIdSet.has(id))), [doneIds, roundIdSet])
  const askedSet = useMemo(() => new Set(askedIds.filter((id) => roundIdSet.has(id))), [askedIds, roundIdSet])

  const pending = useMemo(() => round.filter((j) => !doneSet.has(j.id)), [round, doneSet])
  const missing = useMemo(() => round.filter((j) => askedSet.has(j.id) && !doneSet.has(j.id)), [round, askedSet, doneSet])

  /** 按任务类型分组的全流程进度（完成/总数），顺序按首次出现。 */
  const webBreakdown = useMemo(() => {
    const order: AiJobTask[] = []
    const map = new Map<AiJobTask, { task: AiJobTask; label: string; done: number; total: number }>()
    for (const j of round) {
      let g = map.get(j.task)
      if (!g) {
        g = { task: j.task, label: AI_TASK_LABEL[j.task] ?? j.task, done: 0, total: 0 }
        map.set(j.task, g)
        order.push(j.task)
      }
      g.total++
      if (doneSet.has(j.id)) g.done++
    }
    return order.map((t) => map.get(t)!)
  }, [round, doneSet])

  /** 逐条应用结果；返回成功应用的 id（供网页版标记完成）。 */
  const applyResults = useCallback(
    (results: AiResultEntry[], jobs: AiJob[]) => {
      const byId = new Map(jobs.map((j) => [j.id, j]))
      const lines: string[] = []
      const appliedIds: string[] = []
      let okCount = 0
      let failCount = 0
      for (const r of results) {
        const job = r.id ? byId.get(r.id) : undefined
        const task = job?.task ?? (isAiJobTask(r.task) ? r.task : null)
        if (!task) {
          lines.push(`跳过：找不到任务（id=${r.id || '无'}）`)
          failCount++
          continue
        }
        const res = applyTaskResult(task, r.raw, job?.askedWords ?? r.askedWords ?? [], job?.askedIds ?? r.askedIds ?? [])
        if (res.ok) {
          okCount++
          if (job) appliedIds.push(job.id)
        } else {
          failCount++
        }
        lines.push(`【${job?.label ?? task}】${res.report[0] ?? (res.ok ? '已应用' : '未解析')}`)
      }
      return { okCount, failCount, lines, appliedIds }
    },
    [applyTaskResult],
  )

  // ---------- 本机 agent 路径 ----------

  const exportJobs = useCallback(() => {
    const jobs = buildAiJobs(jobsInput)
    if (!jobs.length) {
      flash('没有待办（生词本已齐，也没有缺译文/语言点/听力题）')
      return
    }
    const pack = buildJobPack(jobs)
    const text = JSON.stringify(pack, null, 2)
    packRef.current = text
    try {
      localStorage.setItem('reader:aiJobPack', text)
    } catch {
      // 忽略
    }
    download(`ai-jobs-${dayKeyLocal(new Date())}.json`, text, 'application/json')
    flash(`已导出 ${jobs.length} 项待办；整包交给 AI 后，把结果 JSON 导回`)
  }, [jobsInput, download, flash])

  const readResults = useCallback(
    async (file: File) => {
      const text = await file.text()
      const { results, error } = parseAiResultPack(text)
      if (error) {
        flash('导入失败：' + error)
        return
      }
      let poolText = packRef.current
      if (!poolText) {
        try {
          poolText = localStorage.getItem('reader:aiJobPack') ?? ''
        } catch {
          poolText = ''
        }
      }
      const jobs = poolText ? (parseJobPack(poolText)?.jobs ?? []) : []
      const target = jobs.length ? jobs : buildAiJobs(jobsInput)
      const { okCount, failCount, lines } = applyResults(results, target)
      const miss = missingJobIds(target, results)
      setMissingIds(miss)
      onReport([`导入完成：成功 ${okCount} / 失败 ${failCount}${miss.length ? `；缺 ${miss.length}` : ''}`, ...lines.slice(0, 40)])
      flash(`导入完成：成功 ${okCount}，失败 ${failCount}${miss.length ? `，缺 ${miss.length}` : ''}`)
    },
    [applyResults, jobsInput, flash, onReport],
  )

  const onFile = useCallback(
    (e: ChangeEvent<HTMLInputElement>) => {
      const f = e.target.files?.[0]
      e.target.value = ''
      if (f) void readResults(f)
    },
    [readResults],
  )

  // ---------- 网页版路径 ----------

  /** 重置网页版进度（重新开始一轮）。 */
  const refreshWebRound = useCallback(() => {
    setAskedIds([])
    setDoneIds([])
    setMissingIds([])
    flash('已重新统计待办；已应用的进度清零')
  }, [setAskedIds, setDoneIds, flash])

  /** 复制「下一批待处理」的网页版提示词（自动跳过已完成的）。 */
  const copyWebPrompt = useCallback(async () => {
    if (!round.length) {
      flash('没有待办（生词本已齐，也没有缺译文/语言点/听力题）')
      return
    }
    if (!pending.length) {
      flash('全部完成了 🎉')
      return
    }
    const size = webBatchSize > 0 ? webBatchSize : pending.length
    const batch = pending.slice(0, size)
    const batchCount = Math.max(1, Math.ceil(pending.length / size))
    const remaining = pending.length - batch.length
    const prompt = buildWebPackPrompt(batch, { batchIndex: 1, batchCount, remaining })
    try {
      await navigator.clipboard.writeText(prompt)
      setAskedIds((prev) => [...new Set([...prev, ...batch.map((j) => j.id)])])
      flash(
        `已复制 ${batch.length} 项${remaining > 0 ? `（还剩 ${remaining} 项）` : ''}；贴回复到框里点「应用网页版结果」`,
      )
    } catch {
      flash('复制失败：浏览器需要 localhost 或 https')
    }
  }, [round.length, pending, webBatchSize, setAskedIds, flash])

  /** 应用网页版整段回复（可能截断），更新进度并报告缺项。返回是否解析到结果。 */
  const applyWeb = useCallback(
    (text: string): boolean => {
      const results = parseWebPackResults(text)
      if (!results.length) {
        onReport(['没解析出结果：确认粘贴的是 AI 的整段回复（含 @@@ANSWER 行，或严格 JSON）'])
        flash('没解析出结果')
        return false
      }
      const { okCount, failCount, lines, appliedIds } = applyResults(results, round)
      const nextDone = new Set([...doneSet, ...appliedIds])
      setDoneIds([...nextDone])
      const stillMissing = round.filter((j) => askedSet.has(j.id) && !nextDone.has(j.id))
      const doneCount = round.filter((j) => nextDone.has(j.id)).length
      const left = round.length - doneCount
      onReport([
        `网页版：本批成功 ${okCount} / 失败 ${failCount}；总进度 ${doneCount}/${round.length}，还差 ${left}${
          stillMissing.length ? `（其中缺项 ${stillMissing.length}）` : ''
        }`,
        ...lines.slice(0, 40),
      ])
      flash(`本批成功 ${okCount}，失败 ${failCount}；还差 ${left} 项`)
      return true
    },
    [applyResults, round, doneSet, askedSet, setDoneIds, onReport, flash],
  )

  /** 只重发「问过但没成功」的项。 */
  const copyWebMissing = useCallback(async () => {
    if (!missing.length) {
      flash('没有缺项了')
      return
    }
    const prompt = buildWebPackPrompt(missing)
    try {
      await navigator.clipboard.writeText(prompt)
      flash(`已复制未返回的 ${missing.length} 项；再贴回点「应用网页版结果」`)
    } catch {
      flash('复制失败：浏览器需要 localhost 或 https')
    }
  }, [missing, flash])

  const doneCount = round.length - pending.length

  return {
    // agent 路径
    jobCount,
    exportJobs,
    fileRef,
    onFile,
    // 网页版
    webBatchSize,
    setWebBatchSize,
    copyWebPrompt,
    applyWeb,
    copyWebMissing,
    refreshWebRound,
    webTotal: round.length,
    webDone: doneCount,
    webPending: pending.length,
    webMissing: missing.length,
    webBreakdown,
    /** 「还要做」的前几项标签（给 UI 提示用）。 */
    webPendingLabels: pending.slice(0, 6).map((j) => j.label),
    agentMissingCount: missingIds.length,
  }
}
