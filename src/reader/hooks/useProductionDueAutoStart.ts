import { useEffect, type Dispatch, type SetStateAction } from 'react'
import type { ProductionMode, ProductionSettings } from '../../core/production'

export interface UseProductionDueAutoStartParams {
  open: boolean
  autoStart: boolean
  setAutoStart: Dispatch<SetStateAction<boolean>>
  stage: 'setup' | 'playing' | 'done'
  scope: ProductionSettings['scope']
  mode: ProductionMode
  fullUseChunks: boolean
  skimUseChunks: boolean
  start: () => Promise<void>
  flash: (message: string) => void
}

/** 到期队列：面板打开且还在选草料页时，自动用本机词块开一组。 */
export function useProductionDueAutoStart({
  open,
  autoStart,
  setAutoStart,
  stage,
  scope,
  mode,
  fullUseChunks,
  skimUseChunks,
  start,
  flash,
}: UseProductionDueAutoStartParams) {
  useEffect(() => {
    if (!open || !autoStart || stage !== 'setup' || scope !== 'due') return
    setAutoStart(false)
    const useChunks = mode === 'full' ? fullUseChunks : skimUseChunks
    if (!useChunks) {
      flash('到期队列需要先打开本机词块；已保留在选草料页')
      return
    }
    void start()
  }, [open, autoStart, stage, scope, mode, fullUseChunks, skimUseChunks, start, flash, setAutoStart])
}
