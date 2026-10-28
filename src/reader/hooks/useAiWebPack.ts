import { useCallback, useMemo, useState, type Dispatch, type SetStateAction } from 'react'
import { buildWebPackPrompt, parseWebPackResults } from '../../core/aiPackage'
import type { AiJob, AiJobsInput, AiResultEntry } from '../../core/aiPackage'
import type { AiApplySummary } from '../../core/aiApplyResult'
import { AI_BATCH_NAME } from '../labels'
import { useLocalStorageState } from './useLocalStorageState'

export interface UseAiWebPackParams {
  jobsInput: Pick<AiJobsInput, 'articleId'>
  /** 当前待办（顺序稳定）。 */
  round: AiJob[]
  /** 还没完成的任务。 */
  pending: AiJob[]
  doneSet: Set<string>
  applyResults: (results: AiResultEntry[], jobs: AiJob[]) => AiApplySummary
  setDoneIds: Dispatch<SetStateAction<string[]>>
  setAutoVocabDone: Dispatch<SetStateAction<string[]>>
  onReport: (lines: string[]) => void
  flash: (message: string) => void
}

/**
 * 网页版路径：复制一批「工作包提示词」→ 贴到 DeepSeek 等网页 → 整段回复贴回应用。
 *
 * 网页端可能截断/漏答，所以进度要持久化（asked / done），并单独提供
 * 「只重发缺项」「重置进度」「重跑本篇自动标词」。队列本身仍由 `useAiPack` 持有，
 * 这里只维护网页路径自己的批次与进度。
 */
export function useAiWebPack({
  jobsInput,
  round,
  pending,
  doneSet,
  applyResults,
  setDoneIds,
  setAutoVocabDone,
  onReport,
  flash,
}: UseAiWebPackParams) {
  /** 网页版每批任务数（0=全部一批）。 */
  const [webBatchSize, setWebBatchSize] = useState(6)
  /** 已复制过、已成功应用的任务 id（持久化，刷新不丢）。 */
  const [askedIds, setAskedIds] = useLocalStorageState<string[]>('reader:aiWebAsked', [])

  const roundIdSet = useMemo(() => new Set(round.map((j) => j.id)), [round])
  const askedSet = useMemo(() => new Set(askedIds.filter((id) => roundIdSet.has(id))), [askedIds, roundIdSet])
  /** 问过但还没成功的项；用于「复制未返回的」重试。 */
  const missing = useMemo(
    () => round.filter((j) => askedSet.has(j.id) && !doneSet.has(j.id)),
    [round, askedSet, doneSet],
  )

  /** 重置进度：清空 done/asked，让所有待办重新显示为未做（不删成果数据）。 */
  const resetWebProgress = useCallback(() => {
    setAskedIds([])
    setDoneIds([])
    // 连「自动标词已完成」也清掉（这样重置后是"完整重来"）
    setAutoVocabDone((prev) => prev.filter((id) => id !== jobsInput.articleId))
    flash('已重置进度（成果不删；所有待办重新显示为未做）')
  }, [jobsInput.articleId, setAskedIds, setDoneIds, setAutoVocabDone, flash])

  /** 只重置本篇「自动标词」的完成标记，让「一键跑批」能重新标词（不动其它进度与数据）。 */
  const rerunAutoVocab = useCallback(() => {
    setAutoVocabDone((prev) => prev.filter((id) => id !== jobsInput.articleId))
    // 同时清掉「自动标词」的历史完成标记（doneIds），否则它仍会被判成已完成而不进待办
    setDoneIds((prev) => prev.filter((id) => !id.startsWith('auto_vocab-')))
    flash(`已重置本篇「自动标词」；再点一次「⚡ ${AI_BATCH_NAME}」即可重新标词`)
  }, [jobsInput.articleId, setAutoVocabDone, setDoneIds, flash])

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
      flash(`已复制 ${batch.length} 项${remaining > 0 ? `（还剩 ${remaining} 项）` : ''}；贴回复到框里点「应用网页版结果」`)
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

  return {
    webBatchSize,
    setWebBatchSize,
    copyWebPrompt,
    applyWeb,
    copyWebMissing,
    resetWebProgress,
    rerunAutoVocab,
    missingCount: missing.length,
  }
}
