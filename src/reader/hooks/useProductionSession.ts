import { useCallback, useEffect, useMemo, useState, type Dispatch, type SetStateAction } from 'react'
import type { ActivityCat } from '../../core/activity'
import {
  checkProductionTargets,
  type ProductionMode,
  type ProductionPrompt,
  type ProductionTargetHit,
  type ProductionTargetPool,
} from '../../core/production'
import {
  buildProductionFeedbackPrompt,
  makeProductionTask,
  parseProductionFeedback,
  type ProductionTask,
} from '../../core/productionPrompts'
import { addWritingRecord, writingRecordKey, type WritingFeedback, type WritingRecord } from '../../core/writing'
import type { AnswerEvent } from '../../core/answerEvents'
import type { WritingErrorProgress } from '../../core/writingErrorProgress'
import {
  deriveProductionProgress,
  makeSkippedProductionRecord,
  productionRecords,
  productionStats,
} from '../../core/productionHistory'
import type { VocabLibrary } from '../../types/document'
import type { ReaderDoc } from './useReaderDoc'
import type { runAiBatch } from '../../adapters/aiRun'
import type { ProductionDraft } from '../../core/productionDraft'
import { useProductionAi } from './useProductionAi'
import { useProductionDraft } from './useProductionDraft'
import { useProductionErrors } from './useProductionErrors'
import { useProductionFollowUp } from './useProductionFollowUp'
import { useProductionPacks, type ProductionStartPayload } from './useProductionPacks'
import { useProductionSettings } from './useProductionSettings'

export type ProductionStage = 'setup' | 'playing' | 'done'

interface FeedbackPending {
  prompt: string
  answer: string
  task: ProductionTask
  hits: ProductionTargetHit[]
  round: number
}

export interface UseProductionSessionParams {
  doc: ReaderDoc | null
  library: VocabLibrary
  articleIdentity: string
  articleTitle: string
  writingHistory: WritingRecord[]
  setWritingHistory: Dispatch<SetStateAction<WritingRecord[]>>
  /** 错因复习：产出批改的 must-fix 也写进同一套错因卡。 */
  writingErrorProgress?: readonly WritingErrorProgress[]
  setWritingErrorProgress?: Dispatch<SetStateAction<WritingErrorProgress[]>>
  answerEvents?: readonly AnswerEvent[]
  recordActivity: (cat: ActivityCat, n?: number) => void
  flash: (message: string) => void
  /** 朗读题干；不传则不显示「听题干」。 */
  speak?: (text: string) => void
  /** 测试注入：AI 直连 / 是否配置了 key / 固定时间。 */
  runAi?: typeof runAiBatch
  aiStatus?: () => Promise<boolean>
  now?: () => Date
}

/**
 * 奶牛工棚的一组产出训练：
 *
 * 选词块 → AI 出中文情境 → 先写英文 → AI 批改 + 本地目标块硬校验
 * → 必须重写一版 → 下一题。每次提交复用 `writingHistory`（source='production'）落盘，
 * 所以历史、备份、导出、导入都不用另造一套。
 */
export function useProductionSession({
  doc,
  library,
  articleIdentity,
  articleTitle,
  writingHistory,
  setWritingHistory,
  writingErrorProgress,
  setWritingErrorProgress,
  answerEvents,
  recordActivity,
  flash,
  speak,
  runAi,
  aiStatus,
  now = () => new Date(),
}: UseProductionSessionParams) {
  const { settings, update: updateSettings } = useProductionSettings()
  const { load: loadDraft, save: saveDraft, clear: clearDraft } = useProductionDraft(articleIdentity)
  const [open, setOpen] = useState(false)
  const [stage, setStage] = useState<ProductionStage>('setup')
  const [prompts, setPrompts] = useState<ProductionPrompt[]>([])
  const [index, setIndex] = useState(0)
  const [answer, setAnswer] = useState('')
  const [feedback, setFeedback] = useState<WritingFeedback | null>(null)
  const [previousFeedback, setPreviousFeedback] = useState<WritingFeedback | null>(null)
  const [hits, setHits] = useState<ProductionTargetHit[]>([])
  const [round, setRound] = useState(1)
  const [grading, setGrading] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [pasteKind, setPasteKind] = useState<'feedback' | ''>('')
  const [pendingFeedback, setPendingFeedback] = useState<FeedbackPending | null>(null)
  const [poolInfo, setPoolInfo] = useState<ProductionTargetPool | null>(null)
  const [sessionTopic, setSessionTopic] = useState('')
  const [sessionMode, setSessionMode] = useState<ProductionMode>(settings.mode)
  const [sessionId, setSessionId] = useState('')
  const [lastRecordKey, setLastRecordKey] = useState('')
  const ai = useProductionAi({ runAi, aiStatus, onCopyError: setError })
  const { ensureAi, callAi, copy, cancel } = ai

  const current = prompts[index] ?? null
  const allHistory = useMemo(() => productionRecords(writingHistory), [writingHistory])
  useProductionErrors({ records: allHistory, writingErrorProgress, setWritingErrorProgress, answerEvents, now })
  const progress = useMemo(() => deriveProductionProgress(allHistory), [allHistory])
  const followUp = useProductionFollowUp({ current, answer, feedback, ensureAi, callAi, flash })
  const stats = useMemo(() => productionStats(allHistory), [allHistory])
  const history = useMemo(
    () =>
      allHistory
        .filter((r) => !articleIdentity || r.articleId === articleIdentity)
        .slice(0, 8),
    [allHistory, articleIdentity],
  )

  const snapshotDraft = useCallback((): ProductionDraft | null => {
    if (stage !== 'playing' || !prompts.length) return null
    return {
      version: 1,
      sessionId,
      articleId: articleIdentity || 'manual',
      at: now().toISOString(),
      mode: sessionMode,
      sessionTopic,
      prompts,
      index,
      answer,
      feedback,
      previousFeedback,
      hits,
      round,
      notice,
    }
  }, [
    stage,
    prompts,
    sessionId,
    articleIdentity,
    now,
    sessionMode,
    sessionTopic,
    index,
    answer,
    feedback,
    previousFeedback,
    hits,
    round,
    notice,
  ])

  useEffect(() => {
    if (!open) return
    const draft = snapshotDraft()
    if (!draft) return
    const timer = setTimeout(() => saveDraft(draft), 250)
    return () => clearTimeout(timer)
  }, [open, snapshotDraft, saveDraft])

  const resetAnswer = useCallback(() => {
    setAnswer('')
    setFeedback(null)
    setPreviousFeedback(null)
    setHits([])
    setRound(1)
    setPasteKind('')
    setPendingFeedback(null)
    setError('')
    setNotice('')
    setLastRecordKey('')
  }, [])

  const applyPrompts = useCallback(
    (next: ProductionPrompt[], pool: ProductionTargetPool, nextNotice = '') => {
      setPrompts(next)
      setPoolInfo(pool)
      setIndex(0)
      resetAnswer()
      setStage('playing')
      setPasteKind('')
      setError('')
      setNotice(nextNotice)
    },
    [resetAnswer],
  )

  const applySession = useCallback(
    (payload: ProductionStartPayload) => {
      setSessionId(payload.sessionId)
      setSessionMode(payload.mode)
      setSessionTopic(payload.topic)
      applyPrompts(payload.prompts, payload.pool, payload.notice)
    },
    [applyPrompts],
  )

  const packs = useProductionPacks({
    settings,
    doc,
    library,
    articleIdentity,
    articleTitle,
    progress,
    now,
    flash,
    ensureAi,
    callAi,
    copy,
    clearDraft,
    onStart: applySession,
  })

  const applyFeedback = useCallback(
    (parsed: NonNullable<ReturnType<typeof parseProductionFeedback>>, pending: FeedbackPending) => {
      const rec: WritingRecord = {
        at: now().toISOString(),
        articleId: articleIdentity || 'manual',
        ...(articleTitle ? { articleTitle } : {}),
        model: pending.task.model,
        text: pending.answer,
        feedback: parsed.feedback,
        // `WritingRecord.task` 的静态形状是 ImitationTask；production 的 hits 作为
        // 附加快照随 JSON 落盘，历史页用 `isProductionTask` 运行时守卫读取。
        task: { ...pending.task, hits: pending.hits, round: pending.round } as typeof pending.task,
        source: 'production',
      }
      const key = writingRecordKey(rec)
      setWritingHistory((h) =>
        h.some((r) => writingRecordKey(r) === key) ? h : addWritingRecord(h, rec),
      )
      setLastRecordKey(key)
      recordActivity('write', 1)
      setFeedback(parsed.feedback)
      setPreviousFeedback(parsed.feedback)
      setHits(pending.hits)
      setRound(pending.round)
      setPasteKind('')
      setPendingFeedback(null)
      setError('')
    },
    [articleIdentity, articleTitle, now, setWritingHistory, recordActivity],
  )

  /** 本地词形匹配漏判时，允许用户手工纠正命中，并写回刚保存的那一稿。 */
  const setHitUsed = useCallback(
    (id: string, used: boolean) => {
      const next = hits.map((h) => (h.id === id ? { ...h, used } : h))
      setHits(next)
      if (!lastRecordKey) return
      setWritingHistory((history) =>
        history.map((rec) =>
          writingRecordKey(rec) === lastRecordKey
            ? {
                ...rec,
                task: { ...rec.task, hits: next } as typeof rec.task,
              }
            : rec,
        ),
      )
    },
    [hits, lastRecordKey, setWritingHistory],
  )

  const grade = useCallback(async () => {
    if (!current) {
      flash('这一题还没有题面')
      return
    }
    const text = answer.trim()
    if (!text) {
      flash('先写一句英文再批改')
      return
    }
    const task = makeProductionTask(current, sessionTopic, sessionMode, sessionId)
    const nextHits = checkProductionTargets(text, current.targets)
    const prompt = buildProductionFeedbackPrompt(
      task,
      text,
      round > 1 && previousFeedback?.issues.length ? previousFeedback.issues : undefined,
    )
    const pending: FeedbackPending = { prompt, answer: text, task, hits: nextHits, round }
    setPendingFeedback(pending)
    setError('')

    if (!(await ensureAi())) {
      setPasteKind('feedback')
      if (await copy(prompt)) flash('已复制批改提示词；把 AI 返回的 JSON 粘到下面')
      return
    }

    setGrading(true)
    try {
      const raw = await callAi('feedback', prompt)
      const parsed = parseProductionFeedback(raw, text)
      if (!parsed) {
        setError('没解析出批改结果：需要 v2 JSON（version / scores / issues / polished / summary）')
        return
      }
      applyFeedback(parsed, pending)
    } catch (e) {
      setError(String((e as Error)?.message || e))
      setPasteKind('feedback')
    } finally {
      setGrading(false)
    }
  }, [current, answer, sessionTopic, round, previousFeedback, sessionMode, sessionId, ensureAi, copy, callAi, flash, applyFeedback])

  const applyFeedbackPaste = useCallback(
    (raw: string) => {
      if (!pendingFeedback) return
      const parsed = parseProductionFeedback(raw, pendingFeedback.answer)
      if (!parsed) {
        setError('没解析出批改结果：需要 v2 JSON（version / scores / issues / polished / summary）')
        return
      }
      applyFeedback(parsed, pendingFeedback)
    },
    [pendingFeedback, applyFeedback],
  )

  const applyPaste = useCallback(
    (raw: string) => {
      if (packs.packPasteKind) packs.applyPacketPaste(raw)
      else if (pasteKind === 'feedback') applyFeedbackPaste(raw)
    },
    [packs, pasteKind, applyFeedbackPaste],
  )

  const copyPromptAgain = useCallback(async () => {
    if (packs.packPasteKind) {
      await packs.copyPromptAgain()
      return
    }
    if (pendingFeedback?.prompt) await copy(pendingFeedback.prompt)
  }, [packs, pendingFeedback, copy])

  const rewrite = useCallback(() => {
    if (!feedback || round >= 2) return
    setPreviousFeedback(feedback)
    setFeedback(null)
    setHits([])
    setRound(2)
    setPasteKind('')
    setError('')
  }, [feedback, round])

  const next = useCallback(() => {
    if (!feedback) {
      flash('先重写一版并批改，再进下一题')
      return
    }
    if (round < 2) {
      flash('先按批改意见重写一版，再进下一题')
      return
    }
    if (index + 1 >= prompts.length) {
      clearDraft()
      setStage('done')
      return
    }
    setIndex((i) => i + 1)
    resetAnswer()
  }, [feedback, round, index, prompts.length, flash, resetAnswer, clearDraft])

  /** 跳过当前题：没有批改时也留一条「跳过」历史，不伪造分数。 */
  const skip = useCallback(() => {
    if (current && !feedback) {
      const rec = makeSkippedProductionRecord({
        task: makeProductionTask(current, sessionTopic, sessionMode, sessionId),
        text: answer.trim(),
        at: now().toISOString(),
        articleId: articleIdentity,
        articleTitle,
        round,
      })
      setWritingHistory((history) => addWritingRecord(history, rec))
    }
    if (index + 1 >= prompts.length) {
      clearDraft()
      setStage('done')
      return
    }
    setIndex((i) => i + 1)
    resetAnswer()
  }, [current, feedback, sessionTopic, sessionMode, sessionId, now, articleIdentity, articleTitle, answer, round, setWritingHistory, index, prompts.length, resetAnswer, clearDraft])

  const restart = useCallback(() => {
    clearDraft()
    packs.reset()
    setStage('setup')
    setPrompts([])
    setPoolInfo(null)
    setIndex(0)
    resetAnswer()
  }, [resetAnswer, clearDraft, packs])

  const openProduction = useCallback(() => {
    if (!open && !prompts.length && stage === 'setup') {
      const draft = loadDraft()
      if (draft) {
        setSessionId(draft.sessionId)
        setSessionMode(draft.mode)
        setSessionTopic(draft.sessionTopic)
        setPrompts(draft.prompts)
        setIndex(draft.index)
        setAnswer(draft.answer)
        setFeedback(draft.feedback)
        setPreviousFeedback(draft.previousFeedback)
        setHits(draft.hits)
        setRound(draft.round)
        setNotice(draft.notice)
        setStage('playing')
        setPasteKind('')
        setError('')
      }
    }
    setOpen(true)
  }, [open, prompts.length, stage, loadDraft])

  const close = useCallback(() => {
    const draft = snapshotDraft()
    if (draft) saveDraft(draft)
    if (stage === 'done') clearDraft()
    cancel()
    packs.reset()
    setGrading(false)
    setPasteKind('')
    setPendingFeedback(null)
    setOpen(false)
    setError('')
  }, [cancel, snapshotDraft, saveDraft, stage, clearDraft, packs])

  const cancelRun = useCallback(() => {
    cancel()
    packs.reset()
    setGrading(false)
  }, [cancel, packs])

  return {
    open,
    articleTitle,
    articleIdentity,
    speak,
    openProduction,
    close,
    stage,
    settings,
    updateSettings,
    start: packs.start,
    startYogurtPairs: packs.startYogurtPairs,
    restart,
    current,
    prompts,
    index,
    answer,
    setAnswer,
    feedback,
    previousFeedback,
    hits,
    setHitUsed,
    round,
    rewrite,
    grade,
    next,
    skip,
    generating: packs.generating,
    grading,
    error: packs.packError || error,
    notice,
    pasteKind: packs.packPasteKind || pasteKind,
    applyPaste,
    copyPromptAgain,
    pendingPrompt: packs.packPasteKind ? packs.pendingPrompt : (pendingFeedback?.prompt ?? ''),
    poolInfo,
    history,
    allHistory,
    progress,
    stats,
    sessionId,
    sessionMode,
    followUp,
    cancelRun,
  }
}
