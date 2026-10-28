import { useCallback, useMemo } from 'react'
import { goldenDrillKey, goldenTargetsFor } from '../../core/golden'
import {
  emptyGoldenRecord,
  findGoldenRecord,
  recordGoldenStep,
  type GoldenDrillRecord,
} from '../../core/goldenProgress'
import type { ActivityCat } from '../../core/activity'
import type { GoldenLesson, GoldenSentence, GoldenTarget, Sentence } from '../../types/document'
import type { GoldenPhase } from './goldenSession'

export interface UseGoldenCurrentParams {
  lesson: GoldenLesson | null
  ordered: GoldenSentence[]
  bySentence: Map<string, Sentence>
  index: number
  records: GoldenDrillRecord[]
  articleId: string
  articleTitle: string
  recordGolden: (record: GoldenDrillRecord) => void
  recordActivity: (cat: ActivityCat, n?: number) => void
  setPhase: (phase: GoldenPhase) => void
  speak: (text: string) => void
}

/**
 * 当前句的派生值与进度写入：指纹、记录、小结、重练、朗读。
 *
 * 位置由 useGoldenSession 提供；这里只回答“这一句现在是什么状态”。
 */
export function useGoldenCurrent({
  lesson,
  ordered,
  bySentence,
  index,
  records,
  articleId,
  articleTitle,
  recordGolden,
  recordActivity,
  setPhase,
  speak,
}: UseGoldenCurrentParams) {
  const current = ordered[index] ?? null
  const currentSentence = current ? bySentence.get(current.id) ?? null : null
  const targets: GoldenTarget[] = lesson && current ? goldenTargetsFor(lesson, current.id) : []
  const drillKey = currentSentence ? goldenDrillKey(currentSentence.text, targets) : ''
  const currentRecord = useMemo(() => {
    if (!current || !drillKey) return null
    return findGoldenRecord(records, articleId, current.id, drillKey)
  }, [records, articleId, current, drillKey])
  const progress =
    currentRecord ??
    (current && drillKey
      ? emptyGoldenRecord(articleId, articleTitle, current.id, drillKey, new Date().toISOString())
      : null)

  const markSummary = useCallback(() => {
    if (!current || !drillKey) return
    const base = currentRecord ?? emptyGoldenRecord(articleId, articleTitle, current.id, drillKey, new Date().toISOString())
    const next = recordGoldenStep(base, 'summary', true, new Date().toISOString())
    recordGolden(next)
    if (!base.summarySeen) recordActivity('write', 1)
    setPhase('summary')
  }, [current, drillKey, currentRecord, articleId, articleTitle, recordGolden, recordActivity, setPhase])

  const speakCurrent = useCallback(() => {
    if (currentSentence) speak(currentSentence.text)
  }, [currentSentence, speak])

  return {
    current,
    currentSentence,
    targets,
    drillKey,
    currentRecord,
    progress,
    markSummary,
    speakCurrent,
  }
}
