import { useCallback, useMemo, useRef, useState } from 'react'
import { goldenDrillKey, goldenTargetsFor } from '../../core/golden'
import { checkGoldenRecall, type GoldenRecallResult } from '../../core/goldenDrill'
import {
  emptyGoldenRecord,
  findGoldenRecord,
  goldenReviewSentenceIds,
  recordGoldenStep,
  resetGoldenRecord,
  type GoldenDrillRecord,
  type GoldenMasterySummary,
} from '../../core/goldenProgress'
import { dayKeyLocal } from '../../core/activity'
import type { AnswerEventInput } from '../../core/answerEvents'
import type { PracticeKind } from '../../core/practice'
import type { GoldenLesson, GoldenSentence, Sentence } from '../../types/document'
import type { GoldenPhase, GoldenView } from './goldenSession'

export interface UseGoldenRecallParams {
  ordered: GoldenSentence[]
  bySentence: Map<string, Sentence>
  lesson: GoldenLesson | null
  records: GoldenDrillRecord[]
  articleId: string
  articleTitle: string
  recallIndex: number
  setRecallIndex: (index: number) => void
  progressFor: (sentenceId: string) => GoldenDrillRecord | null
  summary: GoldenMasterySummary | null
  recordGolden: (record: GoldenDrillRecord) => void
  recordPractice: (kind: PracticeKind, total: number, correct: number) => void
  recordAnswer?: (event: AnswerEventInput) => void
  flash: (message: string) => void
  setView: (view: GoldenView) => void
  setPhase: (phase: GoldenPhase) => void
  setIndex: (index: number) => void
  resetFillAssemble: () => void
}

/**
 * 逆向回顾状态机：待回顾队列、默写输入、判分/看答案、逐句推进。
 *
 * 只处理回顾这一段；进入/退出视图和会话位置由 useGoldenSession 保存，
 * 单句填空/拼句由 useGoldenFillAssemble 负责。
 */
export function useGoldenRecall({
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
}: UseGoldenRecallParams) {
  const [recallInput, setRecallInput] = useState('')
  const [recallChecked, setRecallChecked] = useState<GoldenRecallResult | null>(null)
  const [recallRevealed, setRecallRevealed] = useState(false)
  /** 非空 = 本次是「待回顾」队列，只过已掌握、今天还没回顾的句子。 */
  const [reviewIds, setReviewIds] = useState<string[]>([])
  const practicedRef = useRef(false)

  /** 今天之前掌握、今天还没回顾过的句子（按记录里的 lastAt 逻辑日判断）。 */
  const todayKey = dayKeyLocal()
  const orderedIds = useMemo(() => ordered.map((s) => s.id), [ordered])
  const dueReviewIds = useMemo(
    () => goldenReviewSentenceIds(records, articleId, orderedIds, todayKey),
    [records, articleId, orderedIds, todayKey],
  )
  const reviewCount = dueReviewIds.length
  const recallList = useMemo(() => {
    if (!reviewIds.length) return ordered
    return reviewIds.map((id) => ordered.find((s) => s.id === id)).filter((s): s is NonNullable<typeof s> => !!s)
  }, [reviewIds, ordered])
  const reviewMode = reviewIds.length > 0

  const currentRecallSentence = recallList[recallIndex] ?? null
  const currentRecallText = currentRecallSentence ? bySentence.get(currentRecallSentence.id) ?? null : null
  const currentRecallProgress = currentRecallSentence ? progressFor(currentRecallSentence.id) : null
  const currentRecallTargets =
    lesson && currentRecallSentence ? goldenTargetsFor(lesson, currentRecallSentence.id) : []
  const currentRecallDrillKey = currentRecallText ? goldenDrillKey(currentRecallText.text, currentRecallTargets) : ''

  const resetRecall = useCallback(() => {
    setRecallInput('')
    setRecallChecked(null)
    setRecallRevealed(false)
    practicedRef.current = false
  }, [])

  const startReview = useCallback(() => {
    if (!dueReviewIds.length) {
      flash('今天没有待回顾的金句')
      return
    }
    setReviewIds(dueReviewIds)
    setView('recall')
    setRecallIndex(0)
    resetRecall()
  }, [dueReviewIds, flash, setView, setRecallIndex, resetRecall])

  const startRecall = useCallback(() => {
    if (!ordered.length) {
      flash('先练完遣词造句')
      return
    }
    if (!ordered.every((s) => progressFor(s.id)?.summarySeen === true)) {
      flash('先完成全部句子的遣词造句，再进逆向回顾')
      return
    }
    setReviewIds([])
    setView('recall')
    setRecallIndex(0)
    resetRecall()
  }, [ordered, progressFor, flash, setView, setRecallIndex, resetRecall])

  const checkRecall = useCallback(() => {
    if (!currentRecallText || !currentRecallSentence || !currentRecallDrillKey) return
    const result = checkGoldenRecall(recallInput, currentRecallText.text)
    setRecallChecked(result)
    const base =
      currentRecallProgress ??
      emptyGoldenRecord(articleId, articleTitle, currentRecallSentence.id, currentRecallDrillKey, new Date().toISOString())
    recordGolden(recordGoldenStep(base, 'recall', result.firstOk, new Date().toISOString()))
    recordAnswer?.({
      articleId,
      source: 'golden',
      kind: 'recall',
      cat: 'write',
      correct: result.firstOk,
      questionId: `${currentRecallSentence.id}:recall`,
    })
  }, [
    currentRecallText,
    currentRecallSentence,
    currentRecallDrillKey,
    recallInput,
    currentRecallProgress,
    articleId,
    articleTitle,
    recordGolden,
    recordAnswer,
  ])

  const revealRecall = useCallback(() => {
    if (!currentRecallSentence || !currentRecallDrillKey) return
    setRecallRevealed(true)
    if (recallChecked) return
    const base =
      currentRecallProgress ??
      emptyGoldenRecord(articleId, articleTitle, currentRecallSentence.id, currentRecallDrillKey, new Date().toISOString())
    if ((base.recallTries ?? 0) === 0) {
      recordGolden(recordGoldenStep(base, 'recall', false, new Date().toISOString()))
      recordAnswer?.({
        articleId,
        source: 'golden',
        kind: 'recall',
        cat: 'write',
        correct: false,
        questionId: `${currentRecallSentence.id}:recall`,
      })
    }
  }, [
    currentRecallSentence,
    currentRecallDrillKey,
    currentRecallProgress,
    articleId,
    articleTitle,
    recordGolden,
    recordAnswer,
    recallChecked,
  ])

  const nextRecall = useCallback(() => {
    if (recallIndex + 1 < recallList.length) {
      setRecallIndex(recallIndex + 1)
      setRecallInput('')
      setRecallChecked(null)
      setRecallRevealed(false)
      return
    }
    setView('summary')
    if (!reviewMode && !practicedRef.current) {
      practicedRef.current = true
      const total = ordered.length
      const correct = summary?.masteredSentences ?? 0
      recordPractice('golden', total, correct)
    }
  }, [recallIndex, recallList.length, reviewMode, ordered.length, summary, recordPractice, setView, setRecallIndex])

  /** 逆向回顾失败后「再练一次本句」：重开首次记录，回到这句的遣词造句。 */
  const restartRecallSentence = useCallback(() => {
    const s = recallList[recallIndex]
    const sentence = s ? bySentence.get(s.id) : null
    if (!s || !sentence || !lesson) return
    const t = goldenTargetsFor(lesson, s.id)
    const key = goldenDrillKey(sentence.text, t)
    const at = new Date().toISOString()
    const base = findGoldenRecord(records, articleId, s.id, key) ?? emptyGoldenRecord(articleId, articleTitle, s.id, key, at)
    recordGolden(resetGoldenRecord(base, at))
    setIndex(recallIndex)
    setPhase('preview')
    resetFillAssemble()
    resetRecall()
    setView('drill')
  }, [
    recallList,
    recallIndex,
    bySentence,
    lesson,
    records,
    articleId,
    articleTitle,
    recordGolden,
    resetFillAssemble,
    resetRecall,
    setIndex,
    setPhase,
    setView,
  ])

  return {
    recallList,
    reviewCount,
    reviewMode,
    recallIndex,
    setRecallIndex,
    recallInput,
    setRecallInput,
    recallChecked,
    recallRevealed,
    currentRecallSentence,
    currentRecallText,
    currentRecallProgress,
    resetRecall,
    startReview,
    startRecall,
    checkRecall,
    revealRecall,
    nextRecall,
    restartRecallSentence,
  }
}
