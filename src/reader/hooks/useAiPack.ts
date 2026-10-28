import { useCallback, useMemo } from 'react'
import { buildAiJobs, countAiJobs } from '../../core/aiPackage'
import type { AiJob, AiJobTask, AiJobsInput, AiResultEntry } from '../../core/aiPackage'
import { applyAiResults } from '../../core/aiApplyResult'
import { aiNextHint, buildAiBreakdown, buildAiChecklist } from '../../core/aiProgress'
import { AI_BATCH_NAME } from '../labels'
import { useLocalStorageState } from './useLocalStorageState'
import { useAiAgentPack } from './useAiAgentPack'
import { useAiLocalBatch } from './useAiLocalBatch'
import { useAiWebPack } from './useAiWebPack'

export interface UseAiPackParams {
  jobsInput: AiJobsInput
  applyTaskResult: (
    task: AiJobTask | null,
    raw: string,
    askedWords: string[],
    askedIds: string[],
    meta?: { articleKey?: string },
  ) => { report: string[]; ok: boolean }
  download: (name: string, content: string, mime: string) => void
  flash: (message: string) => void
  onReport: (lines: string[]) => void
}

/**
 * AI 工作包：把「复制提示词 → AI → 粘回」变成批量流程。
 *
 * 三条路各自独立：
 *  - 本机 agent：`useAiAgentPack`（导出 / 导入 JSON）；
 *  - 网页版：`useAiWebPack`（分批复制、粘回、缺项重试）；
 *  - 一键跑批：`useAiLocalBatch`（服务端直连、自动串联多轮）。
 *
 * 本 hook 只持有三路共享的进度（doneIds / autoVocabDone）、队列推导和收尾提示；
 * 具体的文件、剪贴板、轮询状态机都在各自 hook 里，避免一个文件同时管三种 IO。
 */
export function useAiPack({ jobsInput, applyTaskResult, download, flash, onReport }: UseAiPackParams) {
  /** 已成功应用的任务 id（三条路共享，持久化，刷新不丢）。 */
  const [doneIds, setDoneIds] = useLocalStorageState<string[]>('reader:aiWebDone', [])
  /** 已应用过「自动标词」的文章 id（应用过就不再进默认待办）。 */
  const [autoVocabDone, setAutoVocabDone] = useLocalStorageState<string[]>('reader:autoVocabDone', [])

  /** 有效输入：注入本篇的「自动标词已完成」标记。 */
  const jobsInputEff = useMemo<AiJobsInput>(
    () => ({ ...jobsInput, autoVocabDone: autoVocabDone.includes(jobsInput.articleId) }),
    [jobsInput, autoVocabDone],
  )

  /** 当前待办（顺序稳定，id 由内容决定、可复现）。 */
  const round = useMemo(() => buildAiJobs(jobsInputEff), [jobsInputEff])
  const jobCount = useMemo(() => countAiJobs(jobsInputEff), [jobsInputEff])

  const roundIdSet = useMemo(() => new Set(round.map((j) => j.id)), [round])
  const doneSet = useMemo(
    () => new Set(doneIds.filter((id) => roundIdSet.has(id))),
    [doneIds, roundIdSet],
  )
  const pending = useMemo(() => round.filter((j) => !doneSet.has(j.id)), [round, doneSet])

  /** 按任务类型分组的全流程进度（完成/总数），顺序按首次出现。 */
  const webBreakdown = useMemo(() => buildAiBreakdown(round, doneSet), [round, doneSet])

  /**
   * 工作待办检查：把「AI 任务进度」和「需要人工跟进的步骤」合成一张清单。
   * 关键是把「自动标词 → 待选 → 加入生词本 → 补查释义」这个断层显式列出来，
   * 免得跑完批处理以为完事、结果生词本还是空的。
   */
  const checklist = useMemo(
    () => buildAiChecklist(webBreakdown, jobsInput.batch.length),
    [webBreakdown, jobsInput.batch.length],
  )
  const checklistDone = useMemo(() => checklist.reduce((n, it) => n + it.done, 0), [checklist])
  const checklistTotal = useMemo(() => checklist.reduce((n, it) => n + it.total, 0), [checklist])

  /** 本篇是否已经「自动标过词」（标过就不再进默认待办）。 */
  const autoVocabDoneHere = useMemo(
    () => autoVocabDone.includes(jobsInput.articleId),
    [autoVocabDone, jobsInput.articleId],
  )

  /** 逐条应用结果；返回成功应用的 id（供网页版 / 跑批标记完成）。 */
  const applyResults = useCallback(
    (results: AiResultEntry[], jobs: AiJob[]) => {
      const summary = applyAiResults(results, jobs, applyTaskResult)
      // 应用了「自动标词」→ 记下本篇已完成，之后不再进默认待办
      if (summary.autoVocab) {
        setAutoVocabDone((prev) =>
          prev.includes(jobsInput.articleId) ? prev : [...prev, jobsInput.articleId],
        )
      }
      return summary
    },
    [applyTaskResult, jobsInput.articleId, setAutoVocabDone],
  )

  const agent = useAiAgentPack({
    jobsInput: jobsInputEff,
    applyResults,
    download,
    flash,
    onReport,
  })

  const web = useAiWebPack({
    jobsInput: jobsInputEff,
    round,
    pending,
    doneSet,
    applyResults,
    setDoneIds,
    setAutoVocabDone,
    onReport,
    flash,
  })

  const local = useAiLocalBatch({
    jobsInput: jobsInputEff,
    round,
    pending,
    applyResults,
    setDoneIds,
    onReport,
    flash,
  })

  /** 重置网页版进度时，连带清掉 agent 回执的缺项（两路共用「重置」这个动作）。 */
  const resetWebProgress = useCallback(() => {
    web.resetWebProgress()
    agent.clearMissing()
  }, [web.resetWebProgress, agent.clearMissing])

  const nextHint = aiNextHint({
    batchCount: jobsInput.batch.length,
    running: local.running,
    round: local.roundNo,
    phase: local.phase,
    done: local.done,
    total: local.total,
    pending,
    roundCount: round.length,
    autoVocabDone: autoVocabDoneHere,
    batchName: AI_BATCH_NAME,
  })

  const doneCount = round.length - pending.length

  return {
    // agent 路径
    jobCount,
    exportJobs: agent.exportJobs,
    fileRef: agent.fileRef,
    onFile: agent.onFile,
    // 网页版
    webBatchSize: web.webBatchSize,
    setWebBatchSize: web.setWebBatchSize,
    copyWebPrompt: web.copyWebPrompt,
    applyWeb: web.applyWeb,
    copyWebMissing: web.copyWebMissing,
    resetWebProgress,
    autoVocabDoneHere,
    rerunAutoVocab: web.rerunAutoVocab,
    webTotal: round.length,
    webDone: doneCount,
    webPending: pending.length,
    webMissing: web.missingCount,
    webBreakdown,
    /** 「还要做」的前几项标签（给 UI 提示用）。 */
    webPendingLabels: pending.slice(0, 6).map((j) => j.label),
    agentMissingCount: agent.missingCount,
    // 一键跑批（服务端直连）
    localConfigured: local.configured,
    localRunning: local.running,
    localDone: local.done,
    localTotal: local.total,
    localRound: local.roundNo,
    localPhase: local.phase,
    localError: local.error,
    runLocal: local.run,
    cancelLocal: local.cancel,
    skipPending: local.skipPending,
    // 待办检查 / 进度提醒
    checklist,
    checklistDone,
    checklistTotal,
    nextHint,
  }
}
