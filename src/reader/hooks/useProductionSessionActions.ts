import { useCallback, type Dispatch, type SetStateAction } from 'react'
import type { ProductionMode, ProductionPrompt, ProductionTargetPool } from '../../core/production'
import type { ProductionStage } from './useProductionSession'
import type { ProductionStartPayload } from './productionPackRuns'

export interface UseProductionSessionActionsParams {
  setPrompts: Dispatch<SetStateAction<ProductionPrompt[]>>
  setPoolInfo: Dispatch<SetStateAction<ProductionTargetPool | null>>
  setIndex: Dispatch<SetStateAction<number>>
  resetAttempt: () => void
  setStage: Dispatch<SetStateAction<ProductionStage>>
  setNotice: Dispatch<SetStateAction<string>>
  setAiError: Dispatch<SetStateAction<string>>
  setSessionId: Dispatch<SetStateAction<string>>
  setSessionMode: Dispatch<SetStateAction<ProductionMode>>
  setSessionTopic: Dispatch<SetStateAction<string>>
  packPasteKind: string
  applyPacketPaste: (raw: string) => boolean
  attemptPasteKind: string
  applyAttemptFeedbackPaste: (raw: string) => boolean
  copyPackPromptAgain: () => Promise<void>
  copyAttemptPromptAgain: () => Promise<void>
}

/**
 * 把「出题包开始 / AI 结果粘回 / 再复制提示词」接到会话状态。
 * 只做动作映射，不持有题目或草稿。
 */
export function useProductionSessionActions({
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
  packPasteKind,
  applyPacketPaste,
  attemptPasteKind,
  applyAttemptFeedbackPaste,
  copyPackPromptAgain,
  copyAttemptPromptAgain,
}: UseProductionSessionActionsParams) {
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
    [resetAttempt, setAiError, setIndex, setNotice, setPoolInfo, setPrompts, setStage],
  )

  const applySession = useCallback(
    (payload: ProductionStartPayload) => {
      setSessionId(payload.sessionId)
      setSessionMode(payload.mode)
      setSessionTopic(payload.topic)
      applyPrompts(payload.prompts, payload.pool, payload.notice)
    },
    [applyPrompts, setSessionId, setSessionMode, setSessionTopic],
  )

  const applyPaste = useCallback(
    (raw: string): boolean => {
      if (packPasteKind) return applyPacketPaste(raw)
      if (attemptPasteKind === 'feedback') return applyAttemptFeedbackPaste(raw)
      return false
    },
    [packPasteKind, applyPacketPaste, attemptPasteKind, applyAttemptFeedbackPaste],
  )

  const copyPromptAgain = useCallback(async () => {
    if (packPasteKind) {
      await copyPackPromptAgain()
      return
    }
    await copyAttemptPromptAgain()
  }, [packPasteKind, copyPackPromptAgain, copyAttemptPromptAgain])

  return { applySession, applyPaste, copyPromptAgain }
}
