import { useCallback, useMemo, useRef, useState, type ChangeEvent } from 'react'
import {
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

export interface UseAiPackParams {
  /** 当前数据推导出的待办（纯逻辑在 core/aiPackage）。 */
  jobsInput: AiJobsInput
  /** 应用一份 AI 结果；返回回执与是否解析成功。 */
  applyTaskResult: (
    task: AiJobTask | null,
    raw: string,
    askedWords: string[],
    askedIds: string[],
  ) => { report: string[]; ok: boolean }
  /** 触发浏览器下载。 */
  download: (name: string, content: string, mime: string) => void
  flash: (message: string) => void
  /** 回执展示（写进「应用结果」下方）。 */
  onReport: (lines: string[]) => void
}

/**
 * AI 工作包：把「复制提示词 → AI → 粘回」变成批量流程。
 *
 * 两条路：
 *  - 本机 agent：导出 `ai-jobs-*.json` → 喂给 agent → 结果 JSON 导回；
 *  - 网页版（DeepSeek 等）：复制一条「工作包提示词」去网页贴 → 整段回复贴回 → 应用；
 *    网页端可能截断/漏答，所以有**校验缺项 + 一键重问缺项 + 分块**。
 */
export function useAiPack({ jobsInput, applyTaskResult, download, flash, onReport }: UseAiPackParams) {
  const packRef = useRef<string>('')
  const fileRef = useRef<HTMLInputElement | null>(null)
  /** 网页版这轮复制出去的任务（应用结果时按 id 找上下文）。 */
  const webJobsRef = useRef<AiJob[]>([])
  /** 网页版分批游标。 */
  const webOffsetRef = useRef(0)
  /** 上一次没返回的 id（用于「复制未返回的」）。 */
  const [missingIds, setMissingIds] = useState<string[]>([])
  /** 网页版每批任务数（0=全部一批）。 */
  const [webBatchSize, setWebBatchSize] = useState(6)

  const jobCount = useMemo(() => countAiJobs(jobsInput), [jobsInput])

  /** 逐条应用结果（file 导入与网页版应用共用）。 */
  const applyResults = useCallback(
    (results: AiResultEntry[], jobs: AiJob[]) => {
      const byId = new Map(jobs.map((j) => [j.id, j]))
      const lines: string[] = []
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
        if (res.ok) okCount++
        else failCount++
        lines.push(`【${job?.label ?? task}】${res.report[0] ?? (res.ok ? '已应用' : '未解析')}`)
      }
      const missing = missingJobIds(jobs, results)
      setMissingIds(missing)
      const head = `导入完成：成功 ${okCount} / 失败 ${failCount}`
      const tail = missing.length ? `；还有 ${missing.length} 项没返回（可点「复制未返回的」重问）` : ''
      onReport([head + tail, ...lines.slice(0, 40)])
      flash(`导入完成：成功 ${okCount}，失败 ${failCount}${missing.length ? `，缺 ${missing.length}` : ''}`)
    },
    [applyTaskResult, flash, onReport],
  )

  /** 导出：打成一个 JSON 文件，顺便记在本机（导入结果时按 id 找回上下文）。 */
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

  /** 导入（本机 agent 路径）：读结果 JSON，按 id 找上下文逐条应用。 */
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
      applyResults(results, jobs.length ? jobs : buildAiJobs(jobsInput))
    },
    [applyResults, jobsInput, flash],
  )

  /** 复制网页版工作包提示词（可分块）。 */
  const copyWebPrompt = useCallback(async () => {
    const jobs = buildAiJobs(jobsInput)
    if (!jobs.length) {
      flash('没有待办（生词本已齐，也没有缺译文/语言点/听力题）')
      return
    }
    webJobsRef.current = jobs
    const size = webBatchSize > 0 ? webBatchSize : jobs.length
    const batchCount = Math.max(1, Math.ceil(jobs.length / size))
    let batchIndex = Math.floor(webOffsetRef.current / size) + 1
    if (batchIndex > batchCount) {
      webOffsetRef.current = 0
      batchIndex = 1
    }
    const from = (batchIndex - 1) * size
    const batch = jobs.slice(from, from + size)
    webOffsetRef.current = from + size
    if (webOffsetRef.current >= jobs.length) webOffsetRef.current = 0
    const remaining = Math.max(0, jobs.length - (from + batch.length))
    const prompt = buildWebPackPrompt(batch, { batchIndex, batchCount, remaining })
    try {
      await navigator.clipboard.writeText(prompt)
      flash(
        batchCount > 1
          ? `已复制第 ${batchIndex}/${batchCount} 批（${batch.length} 项）；贴回复到框里点「应用网页版结果」`
          : `已复制 ${batch.length} 项网页版提示词；贴回复到框里点「应用网页版结果」`,
      )
    } catch {
      flash('复制失败：浏览器需要 localhost 或 https')
    }
  }, [jobsInput, webBatchSize, flash])

  /** 应用网页版整段回复（可能截断），并校验缺项。 */
  const applyWeb = useCallback(
    (text: string) => {
      const results = parseWebPackResults(text)
      if (!results.length) {
        onReport(['没解析出结果：确认粘贴的是 AI 的整段回复（含 @@@ANSWER 行，或严格 JSON）'])
        flash('没解析出结果')
        return
      }
      const all = webJobsRef.current.length ? webJobsRef.current : buildAiJobs(jobsInput)
      applyResults(results, all)
    },
    [applyResults, jobsInput, onReport, flash],
  )

  /** 复制「没返回的任务」再问一次（只含缺项）。 */
  const copyWebMissing = useCallback(async () => {
    const all = webJobsRef.current.length ? webJobsRef.current : buildAiJobs(jobsInput)
    const missing = new Set(missingIds)
    const jobs = all.filter((j) => missing.has(j.id))
    if (!jobs.length) {
      flash('没有缺项了')
      return
    }
    const prompt = buildWebPackPrompt(jobs)
    try {
      await navigator.clipboard.writeText(prompt)
      flash(`已复制未返回的 ${jobs.length} 项；再贴回点「应用网页版结果」`)
    } catch {
      flash('复制失败：浏览器需要 localhost 或 https')
    }
  }, [jobsInput, missingIds, flash])

  const onFile = useCallback(
    (e: ChangeEvent<HTMLInputElement>) => {
      const f = e.target.files?.[0]
      e.target.value = ''
      if (f) void readResults(f)
    },
    [readResults],
  )

  return {
    jobCount,
    exportJobs,
    fileRef,
    onFile,
    webBatchSize,
    setWebBatchSize,
    copyWebPrompt,
    applyWeb,
    copyWebMissing,
    missingCount: missingIds.length,
  }
}
