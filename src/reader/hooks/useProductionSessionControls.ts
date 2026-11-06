import { useCallback, type Dispatch, type SetStateAction } from 'react'
import type { ProductionPrompt, ProductionTargetPool, ProductionSettings } from '../../core/production'
import type { ProductionStage } from './useProductionSession'

export interface UseProductionSessionControlsParams {
  updateSettings: (patch: Partial<ProductionSettings>) => void
  setAutoStart: Dispatch<SetStateAction<boolean>>
  setOpen: Dispatch<SetStateAction<boolean>>
  setStage: Dispatch<SetStateAction<ProductionStage>>
  setPaused: Dispatch<SetStateAction<boolean>>
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
  setPaused,
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
    setPaused(false)
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
    setPaused,
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
    setPaused(false)
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
    setPaused,
    setOpen,
  ])

  /**
   * 暂停 ≠ 关闭：草稿照存、题号不动，但人退回「工棚主界面」（选草料那一屏），
   * 想改断句、改设置、看历史都行，点「继续这一组」原样回到第几题。
   */
  const pause = useCallback(() => {
    saveNow()
    cancelAi()
    cancelGrading()
    setPaused(true)
  }, [saveNow, cancelAi, cancelGrading, setPaused])

  const resume = useCallback(() => setPaused(false), [setPaused])

  const cancelRun = useCallback(() => {
    cancelAi()
    resetPacks()
    cancelGrading()
  }, [cancelAi, resetPacks, cancelGrading])

  return { openProduction, openDueProduction, close, restart, cancelRun, pause, resume }
}
