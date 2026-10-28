import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from 'react'
import { goldenDrillKey, goldenTargetsFor } from '../../core/golden'
import { checkGoldenRecall, type GoldenRecallResult } from '../../core/goldenDrill'
import {
  emptyGoldenRecord,
  findGoldenRecord as findRecord,
  goldenCompleted,
  goldenMastered,
  goldenReviewSentenceIds,
  recordGoldenStep,
  resetGoldenRecord,
  type GoldenDrillRecord,
} from '../../core/goldenProgress'
import { dayKeyLocal, type ActivityCat } from '../../core/activity'
import type { AnswerEventInput } from '../../core/answerEvents'
import type { PracticeKind } from '../../core/practice'
import type { ReaderDoc } from './useReaderDoc'
import { readGoldenSession, writeGoldenSession, type GoldenPhase, type GoldenView } from './goldenSession'
import { useGoldenFillAssemble } from './useGoldenFillAssemble'
import { useGoldenLesson } from './useGoldenLesson'
import { useGoldenHotkeys } from './useGoldenHotkeys'

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
  const [open, setOpen] = useState(false)
  const [view, setView] = useState<GoldenView>('home')
  const [phase, setPhase] = useState<GoldenPhase>('preview')
  const [index, setIndex] = useState(0)
  const [recallIndex, setRecallIndex] = useState(0)
  const [recallInput, setRecallInput] = useState('')
  const [recallChecked, setRecallChecked] = useState<GoldenRecallResult | null>(null)
  const [recallRevealed, setRecallRevealed] = useState(false)
  /** 非空 = 本次是「待回顾」队列，只过已掌握、今天还没回顾的句子。 */
  const [reviewIds, setReviewIds] = useState<string[]>([])
  const practicedRef = useRef(false)

  const {
    lesson,
    ordered,
    bySentence,
    candidates,
    summary,
    progressFor,
    setSelected,
    setPick,
    toggleSentence,
    setDedupe,
    setBlankUnit,
    setSentenceFill,
    setExamAfter,
  } = useGoldenLesson({
    doc,
    articleId,
    records,
    setDoc,
    setPendingSave,
    flash,
  })

  const current = ordered[index] ?? null
  const currentSentence = current ? bySentence.get(current.id) ?? null : null
  const targets = lesson && current ? goldenTargetsFor(lesson, current.id) : []
  const drillKey = currentSentence ? goldenDrillKey(currentSentence.text, targets) : ''
  const currentRecord = useMemo(() => {
    if (!current || !drillKey) return null
    return findRecord(records, articleId, current.id, drillKey)
  }, [records, articleId, current, drillKey])
  const progress =
    currentRecord ??
    (current && drillKey
      ? emptyGoldenRecord(articleId, articleTitle, current.id, drillKey, new Date().toISOString())
      : null)

  const fillAssemble = useGoldenFillAssemble({
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
    blankUnit,
    sentenceFill,
    fillRoundCount,
    cloze,
    assembly,
    fillInputs,
    setFillInputs,
    fillChecked,
    fillCorrect,
    fillRound,
    fillRoundPassed,
    beginFill,
    checkFill,
    nextFillRound,
    assembleOrder,
    setAssembleOrder,
    assembleChecked,
    beginAssemble,
    checkAssemble,
  } = fillAssemble

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

  const openGolden = useCallback(() => {
    if (!doc || !doc.sentences.length) {
      flash('先打开一篇文章')
      return
    }
    const saved = readGoldenSession(sessionId)
    setOpen(true)
    setView(saved?.view ?? 'home')
    setIndex(saved?.index ?? 0)
    setRecallIndex(saved?.recallIndex ?? 0)
    setPhase('preview')
    fillAssemble.resetFillAssemble()
    setRecallInput('')
    setRecallChecked(null)
    setRecallRevealed(false)
    practicedRef.current = false
  }, [doc, sessionId, flash, fillAssemble.resetFillAssemble])

  const close = useCallback(() => {
    setOpen(false)
    setView('home')
  }, [])

  // 会话位置落本机：刷新后能回到同一课/同一句（学习进度另有 goldenDrills）。
  useEffect(() => {
    if (!open) return
    writeGoldenSession(sessionId, { view, index, recallIndex })
  }, [open, sessionId, view, index, recallIndex])

  const startDrill = useCallback(
    (from = 0) => {
      if (!ordered.length) {
        flash('先选至少一句金句')
        return
      }
      setView('drill')
      setIndex(Math.max(0, Math.min(ordered.length - 1, from)))
      setPhase('preview')
      fillAssemble.resetFillAssemble()
      practicedRef.current = false
    },
    [ordered.length, flash, fillAssemble.resetFillAssemble],
  )

  const startReview = useCallback(() => {
    if (!dueReviewIds.length) {
      flash('今天没有待回顾的金句')
      return
    }
    setReviewIds(dueReviewIds)
    setView('recall')
    setRecallIndex(0)
    setRecallInput('')
    setRecallChecked(null)
    setRecallRevealed(false)
    practicedRef.current = false
  }, [dueReviewIds, flash])

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
    setRecallInput('')
    setRecallChecked(null)
    setRecallRevealed(false)
    practicedRef.current = false
  }, [ordered, progressFor, flash])

  const nextSentence = useCallback(() => {
    fillAssemble.resetFillAssemble()
    setPhase('preview')
    if (index + 1 < ordered.length) setIndex(index + 1)
    else startRecall()
  }, [index, ordered.length, startRecall, fillAssemble.resetFillAssemble])

  const prevSentence = useCallback(() => {
    if (index <= 0) return
    setIndex(index - 1)
    setPhase('preview')
    fillAssemble.resetFillAssemble()
  }, [index, fillAssemble.resetFillAssemble])

  const markSummary = useCallback(() => {
    if (!current || !drillKey) return
    const base = currentRecord ?? emptyGoldenRecord(articleId, articleTitle, current.id, drillKey, new Date().toISOString())
    const next = recordGoldenStep(base, 'summary', true, new Date().toISOString())
    recordGolden(next)
    if (!base.summarySeen) recordActivity('write', 1)
    setPhase('summary')
  }, [current, drillKey, currentRecord, articleId, articleTitle, recordGolden, recordActivity])

  const restartSentence = useCallback(() => {
    if (!current || !drillKey) return
    const at = new Date().toISOString()
    const base = currentRecord ?? emptyGoldenRecord(articleId, articleTitle, current.id, drillKey, at)
    // 已掌握的不降级；没掌握的“再练一次”重开一轮首次记录，给用户掌握的机会。
    recordGolden(resetGoldenRecord(base, at))
    setPhase('preview')
    fillAssemble.resetFillAssemble()
  }, [current, drillKey, currentRecord, articleId, articleTitle, recordGolden, fillAssemble.resetFillAssemble])

  const checkRecall = useCallback(() => {
    if (!currentSentence || !current || !drillKey) return
    const result = checkGoldenRecall(recallInput, currentSentence.text)
    setRecallChecked(result)
    const base = currentRecord ?? emptyGoldenRecord(articleId, articleTitle, current.id, drillKey, new Date().toISOString())
    recordGolden(recordGoldenStep(base, 'recall', result.firstOk, new Date().toISOString()))
    recordAnswer?.({
      articleId,
      source: 'golden',
      kind: 'recall',
      cat: 'write',
      correct: result.firstOk,
      questionId: `${current.id}:recall`,
    })
  }, [currentSentence, current, drillKey, recallInput, currentRecord, articleId, articleTitle, recordGolden, recordAnswer])

  const revealRecall = useCallback(() => {
    if (!current || !drillKey) return
    setRecallRevealed(true)
    if (recallChecked) return
    const base = currentRecord ?? emptyGoldenRecord(articleId, articleTitle, current.id, drillKey, new Date().toISOString())
    if ((base.recallTries ?? 0) === 0) {
      recordGolden(recordGoldenStep(base, 'recall', false, new Date().toISOString()))
      recordAnswer?.({
        articleId,
        source: 'golden',
        kind: 'recall',
        cat: 'write',
        correct: false,
        questionId: `${current.id}:recall`,
      })
    }
  }, [current, drillKey, currentRecord, articleId, articleTitle, recordGolden, recordAnswer, recallChecked])

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
  }, [recallIndex, recallList.length, reviewMode, ordered.length, summary, recordPractice])

  const speakCurrent = useCallback(() => {
    if (currentSentence) speak(currentSentence.text)
  }, [currentSentence, speak])

  /** 逆向回顾失败后「再练一次本句」：重开首次记录，回到这句的遣词造句。 */
  const restartRecallSentence = useCallback(() => {
    const s = recallList[recallIndex]
    const sentence = s ? bySentence.get(s.id) : null
    if (!s || !sentence || !lesson) return
    const t = goldenTargetsFor(lesson, s.id)
    const key = goldenDrillKey(sentence.text, t)
    const at = new Date().toISOString()
    const base = findRecord(records, articleId, s.id, key) ?? emptyGoldenRecord(articleId, articleTitle, s.id, key, at)
    recordGolden(resetGoldenRecord(base, at))
    setIndex(recallIndex)
    setPhase('preview')
    fillAssemble.resetFillAssemble()
    setRecallInput('')
    setRecallChecked(null)
    setRecallRevealed(false)
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
    fillAssemble.resetFillAssemble,
  ])

  const currentRecallSentence = recallList[recallIndex] ?? null
  const currentRecallText = currentRecallSentence ? bySentence.get(currentRecallSentence.id) ?? null : null
  const currentRecallProgress = currentRecallSentence ? progressFor(currentRecallSentence.id) : null

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
    open,
    openGolden,
    close,
    view,
    setView,
    doc,
    articleId,
    setDoc,
    setPendingSave,
    lesson,
    ordered,
    recallList,
    reviewCount,
    reviewMode,
    startReview,
    candidates,
    summary,
    progress,
    progressFor,
    index,
    setIndex,
    current,
    currentSentence,
    targets,
    cloze,
    assembly,
    drillKey,
    phase,
    setPhase,
    fillInputs,
    setFillInputs,
    fillChecked,
    fillCorrect,
    fillRound,
    fillRoundCount,
    fillRoundPassed,
    nextFillRound,
    assembleOrder,
    setAssembleOrder,
    assembleChecked,
    recallIndex,
    setRecallIndex,
    recallInput,
    setRecallInput,
    recallChecked,
    recallRevealed,
    currentRecallSentence,
    currentRecallText,
    currentRecallProgress,
    setSelected,
    setPick,
    toggleSentence,
    setDedupe,
    blankUnit,
    setBlankUnit,
    sentenceFill,
    setSentenceFill,
    setExamAfter,
    startDrill,
    startRecall,
    nextSentence,
    prevSentence,
    beginFill,
    checkFill,
    beginAssemble,
    checkAssemble,
    markSummary,
    restartSentence,
    checkRecall,
    revealRecall,
    nextRecall,
    restartRecallSentence,
    speakCurrent,
    // 供面板显示“完成/掌握”的小工具
    isMastered: (r: GoldenDrillRecord | null) => !!r && goldenMastered(r),
    isCompleted: (r: GoldenDrillRecord | null) => !!r && goldenCompleted(r),
  }
}
