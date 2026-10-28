import { useCallback, useMemo } from 'react'
import { countQuestions, shuffleQuiz, type QuizKind, type QuizQuestion } from '../../core/quiz'
import { poolFor, poolSizes, studyableItems } from '../../core/quizPool'
import type { Sentence, VocabLibrary } from '../../types/document'
import type { MistakeEntry } from '../../core/mistakes'
import type { ActivityCat } from '../../core/activity'
import type { AnswerEventInput } from '../../core/answerEvents'
import type { PracticeKind } from '../../core/practice'
import { useQuizSettings } from './useQuizSettings'
import { useQuizRunState } from './useQuizRunState'
import { useQuizStarts } from './useQuizStarts'
import { useQuizCompletion } from './useQuizCompletion'
import { useQuizTimer } from './useQuizTimer'
import { useQuizHotkeys } from './useQuizHotkeys'
import { createQuizCheck } from '../quiz/createQuizCheck'

export type { QuizResultRow } from '../../core/sessionSnapshots'
export type { QuizScope } from '../../core/quizPool'
export type { DrillWarmupState } from './useQuizStarts'

export interface UseQuizSessionParams {
  library: VocabLibrary
  articleIdentity: string
  docLemmas: Set<string>
  /** 当前文章（文章级测验要句子/译文/语言点）。 */
  doc: { sentences: Sentence[] } | null
  /** 开始一轮考试时关掉其它会话（背单词/听写/快刷）。 */
  closeOthers: () => void
  speak: (text: string) => void
  flash: (message: string) => void
  persist: (library: VocabLibrary) => void
  markStudied: (itemId: string) => void
  recordActivity: (cat: ActivityCat, n?: number) => void
  recordPractice: (kind: PracticeKind, total: number, correct: number) => void
  /** 每题追加一条答题事件（可选；旧调用方不传就只写聚合值）。 */
  recordAnswer?: (event: AnswerEventInput) => void
  addMistake: (entry: MistakeEntry) => void
  dropMistake: (id: string) => void
  /** 一轮考完时按题型汇总（做「词块/搭配正确率」等量化）。 */
  onKinds?: (rows: { kind: QuizKind; total: number; correct: number }[]) => void
  /** 拼错后「从头重学」：交给背单词会话按完整流程重学这些词。 */
  onRelearn?: (ids: string[]) => void
}

/**
 * 考试会话的组装层：出卷、判分、自动下一题、错题重做、快捷键。
 * 对 → SRS good，错 → SRS again（记 lapse），并同步错题本。
 *
 * 具体职责已拆到子 hook：
 *  - 设置 → `useQuizSettings`
 *  - 候选池/出卷 → `core/quizPool` + `useQuizStarts`
 *  - 判分 → `createQuizCheck`
 *  - 完成结算 / 反复鞭打 → `useQuizCompletion`
 *  - 计时 → `useQuizTimer`；快捷键 → `useQuizHotkeys`
 */
export function useQuizSession(params: UseQuizSessionParams) {
  const {
    library,
    articleIdentity,
    docLemmas,
    doc,
    closeOthers,
    speak,
    flash,
    persist,
    markStudied,
    recordActivity,
    recordPractice,
    recordAnswer,
    addMistake,
    dropMistake,
    onKinds,
    onRelearn,
  } = params

  // ---- 设置（持久化，逻辑在 useQuizSettings） ----
  const settings = useQuizSettings()
  const { kinds, setKinds, scope, setScope, limit, auto, unique, speakAfter, articleKinds, setArticleKinds, loopWrong } =
    settings

  // ---- 会话状态（落盘/恢复、切题时序、重置都在 useQuizRunState） ----
  const {
    articleRun,
    setArticleRun,
    setupOpen,
    setSetupOpen,
    spellMiss,
    setSpellMiss,
    allRef,
    recordedRef,
    queue,
    setQueue,
    index,
    input,
    setInput,
    checked,
    setChecked,
    setResult,
    result,
    results,
    setResults,
    autoRun,
    setAutoRun,
    clearAdvance,
    advance,
    next,
    scheduleAdvance,
    resetProgress,
  } = useQuizRunState()

  // ---- 候选池与题量（规则在 core/quizPool） ----
  /** 可考的：用法笔记（中文说明）不出题 */
  const studyable = useMemo(() => studyableItems(library.items), [library.items])
  const poolCtx = useMemo(() => ({ articleIdentity, docLemmas }), [articleIdentity, docLemmas])
  const pool = useMemo(() => poolFor(studyable, scope, poolCtx), [studyable, scope, poolCtx])
  const poolSizesNow = useMemo(() => poolSizes(studyable, kinds), [studyable, kinds])
  const availableCount = useMemo(() => countQuestions(pool, kinds), [pool, kinds])

  const { drillRound, retryWrong, resetDrill, clearDrill } = useQuizCompletion({
    queue,
    index,
    results,
    allRef,
    recordedRef,
    loopWrong,
    recordPractice,
    onKinds,
    flash,
    clearAdvance,
    setQueue,
    setAutoRun,
    resetProgress,
  })

  /** 用一批题开一轮考试（内部复用）。 */
  const begin = useCallback(
    (qs: QuizQuestion[], opts?: { article?: boolean }) => {
      if (!qs.length) {
        flash('这个范围/题型下没题可出（词条可能缺释义或例句）')
        return
      }
      clearAdvance()
      closeOthers()
      allRef.current = qs
      resetDrill()
      setArticleRun(!!opts?.article)
      setQueue(shuffleQuiz(qs))
      resetProgress()
      setAutoRun(auto)
      setSetupOpen(false)
    },
    [clearAdvance, closeOthers, auto, flash, resetProgress, resetDrill],
  )

  const {
    warmup,
    beginWarmup,
    cancelWarmup,
    start,
    startArticle,
    startItems,
    startDrill,
    startArticleDrill,
  } = useQuizStarts({
    doc,
    libraryItems: library.items,
    studyable,
    pool,
    poolCtx,
    kinds,
    setKinds,
    setScope,
    limit,
    unique,
    articleKinds,
    setArticleKinds,
    begin,
    flash,
  })

  /** 判分：对 → SRS good，错 → SRS again（记 lapse）。 */
  const check = createQuizCheck({
    queue,
    index,
    checked,
    input,
    library,
    articleIdentity,
    autoRun,
    speakAfter,
    persist,
    markStudied,
    recordActivity,
    recordAnswer,
    addMistake,
    dropMistake,
    speak,
    scheduleAdvance,
    setChecked,
    setResult,
    setResults,
    setSpellMiss,
  })

  /** 关闭考试并清掉待触发的自动切题（也顺手关掉设置面板）。 */
  const closeSession = useCallback(() => {
    clearAdvance()
    clearDrill()
    setQueue(null)
    setSetupOpen(false)
    setArticleRun(false)
    setSpellMiss(null)
  }, [clearAdvance, clearDrill])

  /** 拼写判错未确认时，不允许直接结束把这次判罚吞掉。 */
  const close = useCallback(() => {
    if (spellMiss) {
      flash('拼错了：先确认「已判为不认识」，再结束考试')
      return
    }
    cancelWarmup()
    closeSession()
  }, [spellMiss, flash, closeSession, cancelWarmup])

  /** 确认拼写判错，继续下一题（该词已进重学队列）。 */
  const ackSpellMiss = useCallback(() => {
    if (!spellMiss) return
    setSpellMiss(null)
    advance()
  }, [spellMiss, advance])

  /** 立即从头重学拼错的词：关掉考试，交给背单词会话走完整流程。 */
  const relearnSpellMiss = useCallback(() => {
    if (!spellMiss) return
    const id = spellMiss.itemId
    closeSession()
    onRelearn?.([id])
  }, [spellMiss, closeSession, onRelearn])

  const seconds = useQuizTimer(queue)

  useQuizHotkeys({
    queue,
    index,
    checked,
    spellMiss,
    onEscape: close,
    onAckSpellMiss: ackSpellMiss,
    onCheck: check,
    onNext: next,
    setInput,
  })

  return {
    // 设置（原样转发 useQuizSettings 的那一批）
    ...settings,
    articleRun,
    drillRound,
    // 会话
    setupOpen,
    setSetupOpen,
    queue,
    setQueue,
    index,
    input,
    setInput,
    checked,
    result,
    results,
    setResults,
    /** 拼写错判定提示；非空时禁止直接切题 / 结束。 */
    spellMiss,
    seconds,
    /** 「先学一遍再考」的预习卡（有内容时面板先画它，队列还没开始） */
    warmup,
    beginWarmup,
    cancelWarmup,
    // 派生
    poolSizes: poolSizesNow,
    availableCount,
    // 动作
    start,
    startArticle,
    startItems,
    startDrill,
    startArticleDrill,
    check,
    next,
    close,
    forceClose: closeSession,
    ackSpellMiss,
    relearnSpellMiss,
    retryWrong,
  }
}
