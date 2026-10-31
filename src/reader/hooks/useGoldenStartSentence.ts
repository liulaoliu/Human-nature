import { useCallback, useEffect, useState } from 'react'
import type { GoldenLesson, GoldenPickMode, GoldenSentence, Sentence } from '../../types/document'
import type { GoldenPhase } from './goldenSession'

/**
 * 错因「去练」的入口：按句 id 落到当前金句课的句子。
 *
 * 句子在本篇但还没选进本课时，先手动加入，再等 `ordered` 更新后进入填空；
 * 不在当前文章 / 当前课里返回 false，调用方给可见提示，不能静默无反应。
 */
export function useGoldenStartSentence({
  ordered,
  lesson,
  bySentence,
  setSelected,
  startDrill,
  setPhase,
}: {
  ordered: GoldenSentence[]
  lesson: GoldenLesson | null
  bySentence: Map<string, Sentence>
  setSelected: (ids: string[], pick: GoldenPickMode) => void
  startDrill: (from?: number) => void
  setPhase: (phase: GoldenPhase) => void
}): (sentenceId: string) => boolean {
  const [pendingId, setPendingId] = useState<string | null>(null)
  const startSentenceDrill = useCallback(
    (sentenceId: string): boolean => {
      const index = ordered.findIndex((s) => s.id === sentenceId)
      if (index >= 0) {
        startDrill(index)
        setPhase('fill')
        return true
      }
      if (!lesson || !bySentence.has(sentenceId)) return false
      const selected = lesson.selected.length ? lesson.selected : ordered.map((s) => s.id)
      // 即使 selected 里已有这个 id，也重写一次：旧课可能只留了 id、没留句子内容，
      // 重写会按本篇正文补回内容，避免 pending 永远等不到 ordered。
      setSelected(selected.includes(sentenceId) ? selected : [...selected, sentenceId], 'manual')
      setPendingId(sentenceId)
      return true
    },
    [ordered, lesson, bySentence, setSelected, startDrill, setPhase],
  )
  useEffect(() => {
    if (!pendingId) return
    const index = ordered.findIndex((s) => s.id === pendingId)
    if (index < 0) return
    setPendingId(null)
    startDrill(index)
    setPhase('fill')
  }, [pendingId, ordered, startDrill, setPhase])
  return startSentenceDrill
}
