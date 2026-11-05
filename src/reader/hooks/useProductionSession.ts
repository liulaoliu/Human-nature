import { useMemo, useRef, useState, type Dispatch, type SetStateAction } from 'react'
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
} from '../../core/productionHistory'
import type { VocabLibrary } from '../../types/document'
import type { ReaderDoc } from './useReaderDoc'
import type { runAiBatch } from '../../adapters/aiRun'
import { useProductionAi } from './useProductionAi'
import { useProductionAttempt } from './useProductionAttempt'
import { useProductionErrors } from './useProductionErrors'
import { useProductionFollowUp } from './useProductionFollowUp'
import { useProductionLegacyMigration } from './useProductionLegacyMigration'
import { useProductionDraftLifecycle } from './useProductionDraftLifecycle'
import { useProductionDueAutoStart } from './useProductionDueAutoStart'
import { useProductionSessionControls } from './useProductionSessionControls'
import { useProductionSessionActions } from './useProductionSessionActions'
import { useProductionHistoryView } from './useProductionHistoryView'
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
  const clearDraftRef = useRef<() => void>(() => {})
  const applySessionRef = useRef<(payload: ProductionStartPayload) => void>(() => {})
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
      clearDraftRef.current()
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
  const legacyMigration = useProductionLegacyMigration({ records: writingHistory, setRecords: setWritingHistory, flash })
  const {
    reset: resetAttempt,
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
  const { stats, history } = useProductionHistoryView(allHistory, articleIdentity)

  const { saveNow, clearDraft, openProduction } = useProductionDraftLifecycle({
    open,
    setOpen,
    stage,
    setStage,
    prompts,
    setPrompts,
    index,
    setIndex,
    sessionId,
    setSessionId,
    sessionMode,
    setSessionMode,
    sessionTopic,
    setSessionTopic,
    notice,
    setNotice,
    setAiError,
    attempt,
    articleIdentity,
    now,
    flash,
  })
  clearDraftRef.current = clearDraft

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
    onStart: (payload) => applySessionRef.current(payload),
  })

  const { start: startPacks, reset: resetPacks } = packs

  const { applySession, applyPaste, copyPromptAgain } = useProductionSessionActions({
    setPrompts,
    setPoolInfo,
    setIndex,
    resetAttempt,
    setStage,
    setNotice,
    setAiError,
    setSessionId,
    setSessionMode,
    setSessionTopic,
    packPasteKind: packs.packPasteKind,
    applyPacketPaste: packs.applyPacketPaste,
    attemptPasteKind: attempt.pasteKind,
    applyAttemptFeedbackPaste,
    copyPackPromptAgain: packs.copyPromptAgain,
    copyAttemptPromptAgain,
  })
  applySessionRef.current = applySession

  useProductionDueAutoStart({
    open,
    autoStart,
    setAutoStart,
    stage,
    scope: settings.scope,
    mode: settings.mode,
    fullUseChunks: settings.fullUseChunks,
    skimUseChunks: settings.skimUseChunks,
    start: startPacks,
    flash,
  })

  const { openDueProduction, close, restart, cancelRun } = useProductionSessionControls({
    updateSettings,
    setAutoStart,
    setOpen,
    setStage,
    setPrompts,
    setIndex,
    setPoolInfo,
    setNotice,
    setAiError,
    saveNow,
    clearDraft,
    resetAttempt,
    resetPacks,
    cancelAi: cancel,
    cancelGrading: cancelGradingAttempt,
    openProduction,
    stage,
  })

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
    legacyMigration,
    cancelRun,
  }
}
