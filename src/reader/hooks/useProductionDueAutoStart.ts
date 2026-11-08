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
  /** 还有没收尾的草稿（刷新过的、暂停的）时不许自动开新组，否则那组就从眼前消失了。 */
  hasSavedDraft: boolean
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
  hasSavedDraft,
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
    // 自动开始会换掉挤奶屏里的一切；有草稿停着时只提示，不覆盖（草稿还在上面那张卡里）。
    if (hasSavedDraft) {
      flash('到期队列没有自动开始：这里还停着一组，先在上面接着做或直接开新的')
      return
    }
    void start()
  }, [
    open,
    autoStart,
    stage,
    scope,
    mode,
    fullUseChunks,
    skimUseChunks,
    hasSavedDraft,
    start,
    flash,
    setAutoStart,
  ])
}
