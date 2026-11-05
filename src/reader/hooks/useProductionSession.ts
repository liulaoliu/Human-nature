import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from 'react'
import type { ActivityCat } from '../../core/activity'
import type {
  ProductionMode,
  ProductionPrompt,
  ProductionTargetPool,
} from '../../core/production'

import type { WritingRecord } from '../../core/writing'
import type { AnswerEvent } from '../../core/answerEvents'
import type { WritingErrorProgress } from '../../core/writingErrorProgress'
import type { ProductionProgress } from '../../core/productionHistory'
import {
  deriveProductionProgress,
  productionRecords,
  productionStats,
} from '../../core/productionHistory'
import type { VocabLibrary } from '../../types/document'
import type { ReaderDoc } from './useReaderDoc'
import type { runAiBatch } from '../../adapters/aiRun'
import type { ProductionDraft } from '../../core/productionDraft'
import { useProductionAi } from './useProductionAi'
import { useProductionAttempt } from './useProductionAttempt'
import { useProductionDraft } from './useProductionDraft'
import { useProductionErrors } from './useProductionErrors'
import { useProductionFollowUp } from './useProductionFollowUp'
import { useProductionLegacyMigration } from './useProductionLegacyMigration'
import { useProductionProgressSync } from './useProductionProgressSync'
import { useProductionPacks, type ProductionStartPayload } from './useProductionPacks'
import { useProductionSettings } from './useProductionSettings'

export type ProductionStage = 'setup' | 'playing' | 'done'

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
  productionProgress?: readonly ProductionProgress[]
  setProductionProgress?: Dispatch<SetStateAction<ProductionProgress[]>>
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
  productionProgress,
  setProductionProgress,
  answerEvents,
  recordActivity,
  flash,
  speak,
  runAi,
  aiStatus,
  now = () => new Date(),
}: UseProductionSessionParams) {
  const { settings, update: updateSettings } = useProductionSettings()
  const remoteDraftRef = useRef<(draft: ProductionDraft) => void>(() => {})
  const lastDraftAtRef = useRef('')
  const { load: loadDraft, save: saveDraft, clear: clearDraft } = useProductionDraft(
    articleIdentity,
    (draft) => remoteDraftRef.current(draft),
  )
  const [open, setOpen] = useState(false)
  const [autoStart, setAutoStart] = useState(false)
  const [stage, setStage] = useState<ProductionStage>('setup')
  const [prompts, setPrompts] = useState<ProductionPrompt[]>([])
  const [index, setIndex] = useState(0)
  const [notice, setNotice] = useState('')
  const [aiError, setAiError] = useState('')
  const [poolInfo, setPoolInfo] = useState<ProductionTargetPool | null>(null)
  const [sessionTopic, setSessionTopic] = useState('')
  const [sessionMode, setSessionMode] = useState<ProductionMode>(settings.mode)
  const [sessionId, setSessionId] = useState('')
  const ai = useProductionAi({ runAi, aiStatus, onCopyError: setAiError })
  const { ensureAi, callAi, copy, cancel } = ai

  const current = prompts[index] ?? null
  const attempt = useProductionAttempt({
    current,
    sessionTopic,
    sessionMode,
    sessionId,
    articleIdentity,
    articleTitle,
    hasNext: index + 1 < prompts.length,
    onNext: () => {
      setNotice('')
      setIndex((i) => i + 1)
    },
    onDone: () => {
      clearDraft()
      setStage('done')
    },
    setWritingHistory,
    recordActivity,
    ensureAi,
    callAi,
    copy,
    flash,
    now,
  })
  remoteDraftRef.current = (draft: ProductionDraft) => {
    if (!open || draft.at <= lastDraftAtRef.current) return
    setSessionId(draft.sessionId)
    setSessionMode(draft.mode)
    setSessionTopic(draft.sessionTopic)
    setPrompts(draft.prompts)
    setIndex(draft.index)
    attempt.restore({
      answer: draft.answer,
      feedback: draft.feedback,
      previousFeedback: draft.previousFeedback,
      hits: draft.hits,
      round: draft.round,
    })
    lastDraftAtRef.current = draft.at
    setNotice(draft.notice)
    setStage('playing')
    setAiError('')
    flash('已同步另一标签页的工棚草稿')
  }

  useProductionLegacyMigration({ records: writingHistory, setRecords: setWritingHistory, flash })
  const {
    reset: resetAttempt,
    restore: restoreAttempt,
    cancelGrading: cancelGradingAttempt,
    applyFeedbackPaste: applyAttemptFeedbackPaste,
    copyPromptAgain: copyAttemptPromptAgain,
  } = attempt
  const allHistory = useMemo(() => productionRecords(writingHistory), [writingHistory])
  useProductionErrors({ records: allHistory, writingErrorProgress, setWritingErrorProgress, answerEvents, now })
  useProductionProgressSync({ records: allHistory, stored: productionProgress, setStored: setProductionProgress })
  const derivedProgress = useMemo(() => deriveProductionProgress(allHistory), [allHistory])
  const progress = useMemo(
    () => (productionProgress && productionProgress.length ? productionProgress : derivedProgress),
    [productionProgress, derivedProgress],
  )
  const followUp = useProductionFollowUp({
    current,
    answer: attempt.answer,
    feedback: attempt.feedback,
    ensureAi,
    callAi,
    flash,
  })
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
      answer: attempt.answer,
      feedback: attempt.feedback,
      previousFeedback: attempt.previousFeedback,
      hits: attempt.hits,
      round: attempt.round,
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
    attempt.answer,
    attempt.feedback,
    attempt.previousFeedback,
    attempt.hits,
    attempt.round,
    notice,
  ])

  useEffect(() => {
    if (!open) return
    const draft = snapshotDraft()
    if (!draft) return
    lastDraftAtRef.current = draft.at
    const timer = setTimeout(() => saveDraft(draft), 250)
    return () => clearTimeout(timer)
  }, [open, snapshotDraft, saveDraft])

  const applyPrompts = useCallback(
    (next: ProductionPrompt[], pool: ProductionTargetPool, nextNotice = '') => {
      setPrompts(next)
      setPoolInfo(pool)
      setIndex(0)
      resetAttempt()
      setStage('playing')
      setNotice(nextNotice)
      setAiError('')
    },
    [resetAttempt],
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

  const {
    start: startPacks,
    reset: resetPacks,
    packPasteKind,
    applyPacketPaste,
    copyPromptAgain: copyPackPromptAgain,
  } = packs

  useEffect(() => {
    if (!open || !autoStart || stage !== 'setup' || settings.scope !== 'due') return
    setAutoStart(false)
    const useChunks =
      settings.mode === 'full' ? settings.fullUseChunks : settings.skimUseChunks
    if (!useChunks) {
      flash('到期队列需要先打开本机词块；已保留在选草料页')
      return
    }
    void startPacks()
  }, [
    open,
    autoStart,
    stage,
    settings.scope,
    settings.mode,
    settings.fullUseChunks,
    settings.skimUseChunks,
    startPacks,
    flash,
  ])

  const applyPaste = useCallback(
    (raw: string) => {
      if (packPasteKind) applyPacketPaste(raw)
      else if (attempt.pasteKind === 'feedback') applyAttemptFeedbackPaste(raw)
    },
    [packPasteKind, applyPacketPaste, attempt.pasteKind, applyAttemptFeedbackPaste],
  )

  const copyPromptAgain = useCallback(async () => {
    if (packPasteKind) {
      await copyPackPromptAgain()
      return
    }
    await copyAttemptPromptAgain()
  }, [packPasteKind, copyPackPromptAgain, copyAttemptPromptAgain])

  const restart = useCallback(() => {
    clearDraft()
    resetPacks()
    setStage('setup')
    setPrompts([])
    setPoolInfo(null)
    setIndex(0)
    resetAttempt()
    setAutoStart(false)
    setNotice('')
    setAiError('')
  }, [resetAttempt, clearDraft, resetPacks])

  const openDueProduction = useCallback(() => {
    updateSettings({ scope: 'due' })
    setAutoStart(true)
    setOpen(true)
  }, [updateSettings])

  const openProduction = useCallback(() => {
    if (!open && !prompts.length && stage === 'setup') {
      const draft = loadDraft()
      if (draft) {
        setSessionId(draft.sessionId)
        setSessionMode(draft.mode)
        setSessionTopic(draft.sessionTopic)
        setPrompts(draft.prompts)
        setIndex(draft.index)
        restoreAttempt({
          answer: draft.answer,
          feedback: draft.feedback,
          previousFeedback: draft.previousFeedback,
          hits: draft.hits,
          round: draft.round,
        })
        lastDraftAtRef.current = draft.at
        setNotice(draft.notice)
        setStage('playing')
        setAiError('')
      }
    }
    setOpen(true)
  }, [open, prompts.length, stage, loadDraft, restoreAttempt])

  const close = useCallback(() => {
    const draft = snapshotDraft()
    if (draft) {
      lastDraftAtRef.current = draft.at
      saveDraft(draft)
    }
    if (stage === 'done') clearDraft()
    cancel()
    resetPacks()
    cancelGradingAttempt()
    setAiError('')
    setAutoStart(false)
    setOpen(false)
  }, [cancel, snapshotDraft, saveDraft, stage, clearDraft, resetPacks, cancelGradingAttempt])

  const cancelRun = useCallback(() => {
    cancel()
    resetPacks()
    cancelGradingAttempt()
  }, [cancel, resetPacks, cancelGradingAttempt])

  return {
    open,
    articleTitle,
    articleIdentity,
    speak,
    openProduction,
    openDueProduction,
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
    answer: attempt.answer,
    setAnswer: attempt.setAnswer,
    feedback: attempt.feedback,
    previousFeedback: attempt.previousFeedback,
    hits: attempt.hits,
    setHitUsed: attempt.setHitUsed,
    round: attempt.round,
    rewrite: attempt.rewrite,
    grade: attempt.grade,
    next: attempt.next,
    skip: attempt.skip,
    generating: packs.generating,
    grading: attempt.grading,
    error: packs.packError || aiError || attempt.error,
    notice,
    pasteKind: packs.packPasteKind || attempt.pasteKind,
    applyPaste,
    copyPromptAgain,
    pendingPrompt: packs.packPasteKind ? packs.pendingPrompt : attempt.pendingPrompt,
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
