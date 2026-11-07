import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react'
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
  setPaused: Dispatch<SetStateAction<boolean>>
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
  setPaused,
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
  const [savedDrafts, setSavedDrafts] = useState<ProductionDraft[]>([])
  const {
    loadNewest,
    listMine,
    save: saveDraft,
    clearFor: clearDraft,
  } = useProductionDraft(articleIdentity, sessionMode, (draft) => remoteDraftRef.current(draft))

  /** 选草料屏要显示「各吃法各停在第几题」，所以草稿列表也得是状态。 */
  const refreshDrafts = useCallback(() => setSavedDrafts(listMine()), [listMine])

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
    refreshDrafts()
    return draft
  }, [snapshotDraft, saveDraft, refreshDrafts])

  useEffect(() => {
    if (!open) return
    const draft = snapshotDraft()
    if (!draft) return
    lastDraftAtRef.current = draft.at
    const timer = setTimeout(() => {
      saveDraft(draft)
      refreshDrafts()
    }, 250)
    return () => clearTimeout(timer)
  }, [open, snapshotDraft, saveDraft, refreshDrafts])

  useEffect(() => {
    if (open) refreshDrafts()
  }, [open, refreshDrafts])

  /** 换到别的吃法再开一组：只清那一组的草稿，暂停着的那组留着。 */
  const clearForMode = useCallback(
    (mode: ProductionMode = sessionMode) => {
      clearDraft(mode)
      refreshDrafts()
    },
    [clearDraft, refreshDrafts, sessionMode],
  )

  /** 选草料屏点「继续这一组」：把那组草稿原样接回去。 */
  const resumeSaved = useCallback(
    (draft: ProductionDraft) => {
      applyDraft(draft)
      refreshDrafts()
    },
    [applyDraft, refreshDrafts],
  )

  const openProduction = useCallback(() => {
    if (!open) {
      // 进工棚先停在「全脂 / 脱脂 / 风味」选择页：未完成的草稿只出现在
      // savedDrafts 里，由用户点「继续这一组」再进挤奶屏，不自动跳进去。
      if (stage === 'playing') saveNow()
      if (stage !== 'setup') setStage('setup')
      setPaused(false)
    }
    setOpen(true)
  }, [open, stage, saveNow, setStage, setPaused, setOpen])

  return {
    loadNewest,
    savedDrafts,
    refreshDrafts,
    resumeSaved,
    saveDraft,
    saveNow,
    clearDraft: clearForMode,
    snapshotDraft,
    openProduction,
  }
}
