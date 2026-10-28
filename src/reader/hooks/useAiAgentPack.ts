import { useCallback, useRef, useState, type ChangeEvent } from 'react'
import {
  buildAiJobs,
  buildJobPack,
  missingJobIds,
  parseAiResultPack,
  parseJobPack,
} from '../../core/aiPackage'
import type { AiJob, AiJobsInput, AiResultEntry } from '../../core/aiPackage'
import type { AiApplySummary } from '../../core/aiApplyResult'
import { dayKeyLocal } from '../../core/activity'

export interface UseAiAgentPackParams {
  /** 已注入「自动标词完成」标记的输入。 */
  jobsInput: AiJobsInput
  applyResults: (results: AiResultEntry[], jobs: AiJob[]) => AiApplySummary
  download: (name: string, content: string, mime: string) => void
  flash: (message: string) => void
  onReport: (lines: string[]) => void
}

/**
 * 本机 agent 路径：导出 `ai-jobs-*.json` → 交给 agent → 结果 JSON 导回。
 *
 * 只负责文件与回执，不碰队列进度；`packRef` 记住刚导出的包，
 * 导回时优先按包里的 jobs 匹配，找不到再用当前输入重建。
 */
export function useAiAgentPack({ jobsInput, applyResults, download, flash, onReport }: UseAiAgentPackParams) {
  const packRef = useRef<string>('')
  const fileRef = useRef<HTMLInputElement | null>(null)
  /** agent 路径回执里缺的词（用于「复制未返回的」重试）。 */
  const [missingIds, setMissingIds] = useState<string[]>([])

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
    flash(`已导出 ${jobs.length} 项待办（包内含结果格式说明）；整包交给 AI，把结果 JSON 导回`)
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

  /** 重置进度时把 agent 回执的缺项也清掉（与旧行为一致）。 */
  const clearMissing = useCallback(() => setMissingIds([]), [])

  return {
    exportJobs,
    fileRef,
    onFile,
    missingCount: missingIds.length,
    clearMissing,
  }
}
