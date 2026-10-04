import { useCallback, useMemo, useRef, type ChangeEvent } from 'react'
import { buildAiJobs, buildJobPack, countAiJobs, isAiJobTask, parseAiResultPack, parseJobPack } from '../../core/aiPackage'
import { dayKeyLocal } from '../../core/activity'
import type { AiJobsInput, AiJobTask } from '../../core/aiPackage'

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
 * AI 工作包：把「复制提示词 → 网页版 AI → 粘回」变成「导出待办 → 整包给 AI → 导回结果」。
 *
 * 提示词推导与结果解析在 core/aiPackage；这里只管导出 / 导入的交互与回执。
 */
export function useAiPack({ jobsInput, applyTaskResult, download, flash, onReport }: UseAiPackParams) {
  const packRef = useRef<string>('')
  const fileRef = useRef<HTMLInputElement | null>(null)

  const jobCount = useMemo(() => countAiJobs(jobsInput), [jobsInput])

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

  /** 导入：按 job id 找回任务与上下文，逐条应用并汇总回执。 */
  const readResults = useCallback(
    async (file: File) => {
      const text = await file.text()
      const { results, error } = parseAiResultPack(text)
      if (error) {
        flash('导入失败：' + error)
        return
      }
      // 找回最近一次导出的 job 列表（内存优先，其次 localStorage）
      let poolText = packRef.current
      if (!poolText) {
        try {
          poolText = localStorage.getItem('reader:aiJobPack') ?? ''
        } catch {
          poolText = ''
        }
      }
      const pool = poolText ? (parseJobPack(poolText)?.jobs ?? []) : []
      const byId = new Map(pool.map((j) => [j.id, j]))
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
      onReport([`导入完成：成功 ${okCount} / 失败 ${failCount}`, ...lines.slice(0, 40)])
      flash(`导入完成：成功 ${okCount}，失败 ${failCount}`)
    },
    [applyTaskResult, flash, onReport],
  )

  const onFile = useCallback(
    (e: ChangeEvent<HTMLInputElement>) => {
      const f = e.target.files?.[0]
      e.target.value = ''
      if (f) void readResults(f)
    },
    [readResults],
  )

  return { jobCount, exportJobs, fileRef, onFile }
}
