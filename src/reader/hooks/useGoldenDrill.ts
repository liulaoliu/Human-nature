import { useCallback, type Dispatch, type SetStateAction } from 'react'
import {
  emptyGoldenRecord,
  goldenCompleted,
  goldenMastered,
  resetGoldenRecord,
  type GoldenDrillRecord,
} from '../../core/goldenProgress'
import type { ActivityCat } from '../../core/activity'
import type { AnswerEventInput } from '../../core/answerEvents'
import type { PracticeKind } from '../../core/practice'
import type { ReaderDoc } from './useReaderDoc'
import { useGoldenCurrent } from './useGoldenCurrent'
import { useGoldenFillAssemble } from './useGoldenFillAssemble'
import { useGoldenLesson } from './useGoldenLesson'
import { useGoldenHotkeys } from './useGoldenHotkeys'
import { useGoldenRecall } from './useGoldenRecall'
import { useGoldenSession } from './useGoldenSession'

export type { GoldenPhase, GoldenView } from './goldenSession'

export interface UseGoldenDrillParams {
  doc: ReaderDoc | null
  /** 学习记录归属键：优先 SavedArticle.id，其次文章标识 */
  articleId: string
  articleTitle: string
  articleKey: string | null
  records: GoldenDrillRecord[]
  recordGolden: (record: GoldenDrillRecord) => void
  recordActivity: (cat: ActivityCat, n?: number) => void
  recordPractice: (kind: PracticeKind, total: number, correct: number) => void
  recordAnswer?: (event: AnswerEventInput) => void
  speak: (text: string) => void
  flash: (message: string) => void
  setDoc: Dispatch<SetStateAction<ReaderDoc | null>>
  setPendingSave: (v: boolean) => void
}

/**
 * D老师小课堂的会话状态机：选金句 → 逐句（预览/填空/拼句/小结）→ 逆向回顾 → 总结。
 *
 * 唯一的进度写入口是 `recordGolden`；内容改动走 `setDoc + setPendingSave`。
 * 内容指纹用 `goldenDrillKey`，改正文或重新生成后旧进度不会误用。
 */
export function useGoldenDrill(params: UseGoldenDrillParams) {
  const {
    doc,
    articleId,
    articleTitle,
    articleKey,
    records,
    recordGolden,
    recordActivity,
    recordPractice,
    recordAnswer,
    speak,
    flash,
    setDoc,
    setPendingSave,
  } = params

  const sessionId = articleKey || articleId
  const lessonApi = useGoldenLesson({
    doc,
    articleId,
    records,
    setDoc,
    setPendingSave,
    flash,
  })
  const { lesson, ordered, bySentence, summary, progressFor } = lessonApi

  const sessionApi = useGoldenSession({ doc, sessionId, orderedLength: ordered.length, flash })
  const {
    open,
    view,
    setView,
    phase,
    setPhase,
    index,
    setIndex,
    recallIndex,
    setRecallIndex,
    openGolden: openSession,
    close,
    startDrill: startSessionDrill,
  } = sessionApi

  const currentApi = useGoldenCurrent({
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
  })
  const { current, currentSentence, targets, drillKey, currentRecord, markSummary, speakCurrent } = currentApi

  const fillApi = useGoldenFillAssemble({
    lesson,
    current,
    currentSentence,
    targets,
    drillKey,
    currentRecord,
    articleId,
    articleTitle,
    recordGolden,
    recordAnswer,
    setPhase,
  })
  const {
    cloze,
    assembly,
    fillCorrect,
    fillRoundPassed,
    assembleOrder,
    assembleChecked,
    beginFill,
    checkFill,
    nextFillRound,
    beginAssemble,
    checkAssemble,
    resetFillAssemble,
  } = fillApi

  const restartSentence = useCallback(() => {
    if (!current || !drillKey) return
    const at = new Date().toISOString()
    const base = currentRecord ?? emptyGoldenRecord(articleId, articleTitle, current.id, drillKey, at)
    // 已掌握的不降级；没掌握的“再练一次”重开一轮首次记录，给用户掌握的机会。
    recordGolden(resetGoldenRecord(base, at))
    setPhase('preview')
    resetFillAssemble()
  }, [current, drillKey, currentRecord, articleId, articleTitle, recordGolden, resetFillAssemble, setPhase])

  const recallApi = useGoldenRecall({
    ordered,
    bySentence,
    lesson,
    records,
    articleId,
    articleTitle,
    recallIndex,
    setRecallIndex,
    progressFor,
    summary,
    recordGolden,
    recordPractice,
    recordAnswer,
    flash,
    setView,
    setPhase,
    setIndex,
    resetFillAssemble,
  })
  const {
    recallChecked,
    resetRecall,
    startRecall,
    checkRecall,
    revealRecall,
    nextRecall,
    restartRecallSentence,
  } = recallApi

  const openGolden = useCallback(() => {
    if (!openSession()) return
    resetFillAssemble()
    resetRecall()
  }, [openSession, resetFillAssemble, resetRecall])

  const startDrill = useCallback(
    (from = 0) => {
      if (!startSessionDrill(from)) return
      resetFillAssemble()
      resetRecall()
    },
    [startSessionDrill, resetFillAssemble, resetRecall],
  )

  const nextSentence = useCallback(() => {
    resetFillAssemble()
    setPhase('preview')
    if (index + 1 < ordered.length) setIndex(index + 1)
    else startRecall()
  }, [index, ordered.length, startRecall, resetFillAssemble, setIndex, setPhase])

  const prevSentence = useCallback(() => {
    if (index <= 0) return
    setIndex(index - 1)
    setPhase('preview')
    resetFillAssemble()
  }, [index, resetFillAssemble, setIndex, setPhase])

  useGoldenHotkeys(
    {
      open,
      view,
      phase,
      hasCloze: !!cloze,
      hasAssembly: !!assembly,
      fillCorrect,
      fillRoundPassed,
      assembleChecked,
      assembleOrderLength: assembleOrder.length,
      assembleTargetCount: assembly?.cloze.targets.length ?? 0,
      recallChecked: !!recallChecked,
    },
    {
      close,
      startDrill,
      setView,
      setPhase,
      beginFill,
      checkFill,
      nextFillRound,
      beginAssemble,
      checkAssemble,
      markSummary,
      nextSentence,
      prevSentence,
      restartSentence,
      revealRecall,
      checkRecall,
      nextRecall,
      restartRecallSentence,
      speakCurrent,
    },
  )

  return {
    ...sessionApi,
    ...lessonApi,
    ...currentApi,
    ...fillApi,
    ...recallApi,
    doc,
    articleId,
    setDoc,
    setPendingSave,
    openGolden,
    startDrill,
    nextSentence,
    prevSentence,
    restartSentence,
    // 供面板显示“完成/掌握”的小工具
    isMastered: (r: GoldenDrillRecord | null) => !!r && goldenMastered(r),
    isCompleted: (r: GoldenDrillRecord | null) => !!r && goldenCompleted(r),
  }
}
