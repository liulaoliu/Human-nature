import { useCallback, useEffect, useRef, type Dispatch, type SetStateAction } from 'react'
import type { ProductionDraft } from '../../core/productionDraft'
import type { ProductionMode, ProductionPrompt } from '../../core/production'
import type { ProductionAttemptSnapshot } from './useProductionAttempt'
import { useProductionDraft } from './useProductionDraft'
import type { ProductionStage } from './useProductionSession'

export interface ProductionDraftAttempt extends ProductionAttemptSnapshot {
  restore: (snapshot: ProductionAttemptSnapshot) => void
}

export interface UseProductionDraftLifecycleParams {
  open: boolean
  setOpen: Dispatch<SetStateAction<boolean>>
  stage: ProductionStage
  setStage: Dispatch<SetStateAction<ProductionStage>>
  prompts: ProductionPrompt[]
  setPrompts: Dispatch<SetStateAction<ProductionPrompt[]>>
  index: number
  setIndex: Dispatch<SetStateAction<number>>
  sessionId: string
  setSessionId: Dispatch<SetStateAction<string>>
  sessionMode: ProductionMode
  setSessionMode: Dispatch<SetStateAction<ProductionMode>>
  sessionTopic: string
  setSessionTopic: Dispatch<SetStateAction<string>>
  notice: string
  setNotice: Dispatch<SetStateAction<string>>
  setAiError: Dispatch<SetStateAction<string>>
  attempt: ProductionDraftAttempt
  articleIdentity: string
  now: () => Date
  flash: (message: string) => void
}

/**
 * 草稿生命周期：本机自动保存、跨标签页恢复、打开时恢复。
 * 会话 hook 只拿 snapshot / open；storage 细节不混在出题和批改里。
 */
export function useProductionDraftLifecycle({
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
}: UseProductionDraftLifecycleParams) {
  const remoteDraftRef = useRef<(draft: ProductionDraft) => void>(() => {})
  const lastDraftAtRef = useRef('')
  const { load: loadDraft, save: saveDraft, clear: clearDraft } = useProductionDraft(
    articleIdentity,
    (draft) => remoteDraftRef.current(draft),
  )

  const applyDraft = useCallback(
    (draft: ProductionDraft) => {
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
    },
    [
      attempt,
      setAiError,
      setIndex,
      setNotice,
      setPrompts,
      setSessionId,
      setSessionMode,
      setSessionTopic,
      setStage,
    ],
  )

  remoteDraftRef.current = (draft: ProductionDraft) => {
    if (!open || draft.at <= lastDraftAtRef.current) return
    applyDraft(draft)
    flash('已同步另一标签页的工棚草稿')
  }

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

  const saveNow = useCallback(() => {
    const draft = snapshotDraft()
    if (!draft) return null
    lastDraftAtRef.current = draft.at
    saveDraft(draft)
    return draft
  }, [snapshotDraft, saveDraft])

  useEffect(() => {
    if (!open) return
    const draft = snapshotDraft()
    if (!draft) return
    lastDraftAtRef.current = draft.at
    const timer = setTimeout(() => saveDraft(draft), 250)
    return () => clearTimeout(timer)
  }, [open, snapshotDraft, saveDraft])

  const openProduction = useCallback(() => {
    if (!open && !prompts.length && stage === 'setup') {
      const draft = loadDraft()
      if (draft) applyDraft(draft)
    }
    setOpen(true)
  }, [open, prompts.length, stage, loadDraft, applyDraft, setOpen])

  return { loadDraft, saveDraft, saveNow, clearDraft, snapshotDraft, openProduction }
}
