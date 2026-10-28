import { useCallback, useEffect, useState } from 'react'
import { readGoldenSession, writeGoldenSession, type GoldenPhase, type GoldenView } from './goldenSession'
import type { ReaderDoc } from './useReaderDoc'

export interface UseGoldenSessionParams {
  doc: ReaderDoc | null
  /** 学习记录归属键：优先 SavedArticle.id，其次文章标识。 */
  sessionId: string
  orderedLength: number
  flash: (message: string) => void
}

/**
 * 金句课的会话外壳：打开/关闭、视图、阶段、当前句位置与刷新恢复。
 *
 * 只保存“人走到哪了”，不碰练习输入和进度写入；练习状态机分别留在
 * useGoldenFillAssemble / useGoldenRecall。
 */
export function useGoldenSession({ doc, sessionId, orderedLength, flash }: UseGoldenSessionParams) {
  const [open, setOpen] = useState(false)
  const [view, setView] = useState<GoldenView>('home')
  const [phase, setPhase] = useState<GoldenPhase>('preview')
  const [index, setIndex] = useState(0)
  const [recallIndex, setRecallIndex] = useState(0)

  /** 返回是否真的打开了，调用方据此决定是否清空练习输入。 */
  const openGolden = useCallback((): boolean => {
    if (!doc || !doc.sentences.length) {
      flash('先打开一篇文章')
      return false
    }
    const saved = readGoldenSession(sessionId)
    setOpen(true)
    setView(saved?.view ?? 'home')
    setIndex(saved?.index ?? 0)
    setRecallIndex(saved?.recallIndex ?? 0)
    setPhase('preview')
    return true
  }, [doc, sessionId, flash])

  const close = useCallback(() => {
    setOpen(false)
    setView('home')
  }, [])

  // 会话位置落本机：刷新后能回到同一课/同一句（学习进度另有 goldenDrills）。
  useEffect(() => {
    if (!open) return
    writeGoldenSession(sessionId, { view, index, recallIndex })
  }, [open, sessionId, view, index, recallIndex])

  /** 返回是否真的开始了，调用方据此决定是否清空练习输入。 */
  const startDrill = useCallback(
    (from = 0): boolean => {
      if (!orderedLength) {
        flash('先选至少一句金句')
        return false
      }
      setView('drill')
      setIndex(Math.max(0, Math.min(orderedLength - 1, from)))
      setPhase('preview')
      return true
    },
    [orderedLength, flash],
  )

  return {
    open,
    view,
    setView,
    phase,
    setPhase,
    index,
    setIndex,
    recallIndex,
    setRecallIndex,
    openGolden,
    close,
    startDrill,
  }
}
