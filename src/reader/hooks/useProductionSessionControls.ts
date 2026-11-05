import { useCallback, type Dispatch, type SetStateAction } from 'react'
import type { ProductionPrompt, ProductionTargetPool, ProductionSettings } from '../../core/production'
import type { ProductionStage } from './useProductionSession'

export interface UseProductionSessionControlsParams {
  updateSettings: (patch: Partial<ProductionSettings>) => void
  setAutoStart: Dispatch<SetStateAction<boolean>>
  setOpen: Dispatch<SetStateAction<boolean>>
  setStage: Dispatch<SetStateAction<ProductionStage>>
  setPrompts: Dispatch<SetStateAction<ProductionPrompt[]>>
  setIndex: Dispatch<SetStateAction<number>>
  setPoolInfo: Dispatch<SetStateAction<ProductionTargetPool | null>>
  setNotice: Dispatch<SetStateAction<string>>
  setAiError: Dispatch<SetStateAction<string>>
  saveNow: () => unknown
  clearDraft: () => void
  resetAttempt: () => void
  resetPacks: () => void
  cancelAi: () => void
  cancelGrading: () => void
  openProduction: () => void
  stage: ProductionStage
}

/**
 * 工棚的开关 / 重开 / 取消：只做状态收尾，不碰出题和批改。
 * 打开入口来自草稿生命周期，保证恢复草稿的逻辑只有一份。
 */
export function useProductionSessionControls({
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
  cancelAi,
  cancelGrading,
  openProduction,
  stage,
}: UseProductionSessionControlsParams) {
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
  }, [
    clearDraft,
    resetPacks,
    setStage,
    setPrompts,
    setPoolInfo,
    setIndex,
    resetAttempt,
    setAutoStart,
    setNotice,
    setAiError,
  ])

  const openDueProduction = useCallback(() => {
    updateSettings({ scope: 'due' })
    setAutoStart(true)
    setOpen(true)
  }, [updateSettings, setAutoStart, setOpen])

  const close = useCallback(() => {
    saveNow()
    if (stage === 'done') clearDraft()
    cancelAi()
    resetPacks()
    cancelGrading()
    setAiError('')
    setAutoStart(false)
    setOpen(false)
  }, [
    saveNow,
    stage,
    clearDraft,
    cancelAi,
    resetPacks,
    cancelGrading,
    setAiError,
    setAutoStart,
    setOpen,
  ])

  const cancelRun = useCallback(() => {
    cancelAi()
    resetPacks()
    cancelGrading()
  }, [cancelAi, resetPacks, cancelGrading])

  return { openProduction, openDueProduction, close, restart, cancelRun }
}
