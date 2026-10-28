import { useCallback, useRef, useState } from 'react'
import type { MutableRefObject } from 'react'
import type { ActivityCat } from '../../core/activity'
import type { AnswerEventInput } from '../../core/answerEvents'
import type { PracticeKind } from '../../core/practice'
import type { MistakeEntry } from '../../core/mistakes'
import type { VocabLibrary } from '../../types/document'
import type { ReaderDoc } from './useReaderDoc'
import type { AiTaskKey } from './aiTasks'
import { useDictation } from './useDictation'
import type { BackTranslationRecord } from '../../core/backTranslate'
import { useVocabMode } from './useVocabMode'
import { useMistakeActions } from './useMistakeActions'
import { useHotkeys } from '../useHotkeys'
import type { PickSession } from '../../core/vocabStats'
import type { BatchItemLike } from '../batchItem'
import { useStudyQuizListen } from './useStudyQuizListen'
import { useQuickWritingBack } from './useQuickWritingBack'
import type { SessionKey } from './sessionKeys'

export interface UseSessionServicesParams {
  library: VocabLibrary
  articleIdentity: string
  articleTitle: string
  docLemmas: Set<string>
  doc: ReaderDoc | null
  selectedId: string | null
  speak: (text: string) => void
  flash: (message: string) => void
  persist: (library: VocabLibrary) => void
  markStudied: (itemId: string) => void
  recordActivity: (cat: ActivityCat, n?: number) => void
  recordPractice: (kind: PracticeKind, total: number, correct: number) => void
  recordAnswer: (event: AnswerEventInput) => void
  addMistake: (entry: MistakeEntry) => void
  dropMistake: (id: string) => void
  studyFlush: (seconds: number, cards: number) => void
  newLimit: number
  newToday: number
  bumpNewToday: () => void
  mergeKindStats: (rows: { kind: string; total: number; correct: number }[]) => void
  setLastTask: (task: AiTaskKey) => void
  askedWordsRef: MutableRefObject<string[]>
  askedIdsRef: MutableRefObject<string[]>
  setSessions: (updater: (prev: PickSession[]) => PickSession[]) => void
  mistakes: MistakeEntry[]
  setIntensiveOpen: (open: boolean) => void
  setSpeedReadOpen: (open: boolean) => void
  warmTexts: (texts: string[]) => void
  warmTimings: (texts: string[]) => void
  mergeBatch: (items: BatchItemLike[]) => void
  batchItemsFromWords: (words: string[]) => BatchItemLike[]
  /** 回译存档（useLearningData）与追加动作 */
  backTranslations: BackTranslationRecord[]
  saveBackTranslation: (rec: BackTranslationRecord) => void
}

/**
 * 所有「会话」服务的组装：学习组（背词/考试/听力）+ 快刷/听写 + 仿写/回译，
 * 外加选词计时与错题重练。
 *
 * 各会话的 close 动作统一注册在 closers；开始一个会话只按组关闭，不再每个 closeOthers
 * 手抄一遍。学习组内部的顺序与互斥在 useStudyQuizListen。
 */
export function useSessionServices({
  library,
  articleIdentity,
  articleTitle,
  docLemmas,
  doc,
  selectedId,
  speak,
  flash,
  persist,
  markStudied,
  recordActivity,
  recordPractice,
  recordAnswer,
  addMistake,
  dropMistake,
  studyFlush,
  newLimit,
  newToday,
  bumpNewToday,
  mergeKindStats,
  setLastTask,
  askedWordsRef,
  askedIdsRef,
  setSessions,
  mistakes,
  setIntensiveOpen,
  setSpeedReadOpen,
  warmTexts,
  warmTimings,
  mergeBatch,
  batchItemsFromWords,
  backTranslations,
  saveBackTranslation,
}: UseSessionServicesParams) {
  const dictApiRef = useRef<ReturnType<typeof useDictation> | null>(null)
  /** 各会话的关闭动作；开始一个会话时按组关闭，避免每个 closeOthers 手抄一遍。 */
  const closers = useRef<Partial<Record<SessionKey, () => void>>>({})
  const closeSessions = useCallback((...keys: SessionKey[]) => {
    for (const key of keys) closers.current[key]?.()
  }, [])
  const closeTransient = useCallback(() => closeSessions('quick', 'dictation'), [closeSessions])

  const studyGroup = useStudyQuizListen({
    library,
    articleIdentity,
    docLemmas,
    doc,
    speak,
    flash,
    persist,
    markStudied,
    recordActivity,
    recordPractice,
    recordAnswer,
    addMistake,
    dropMistake,
    studyFlush,
    newLimit,
    newToday,
    bumpNewToday,
    mergeKindStats,
    setLastTask,
    askedWordsRef,
    askedIdsRef,
    closeTransient,
  })
  const {
    studyApi,
    studyQueue,
    studyPool,
    studyUnflushed,
    startStudy,
    closeStudy,
    quizApi,
    setQuizScope,
    setQuizLoopWrong,
    quizSetupOpen,
    setQuizSetupOpen,
    quizQueue,
    setQuizQueue,
    quizIndex,
    quizArticleKinds,
    startArticleQuiz,
    startQuizItems,
    startQuizDrill,
    startQuizArticleDrill,
    listenApi,
    listenQuiz,
    setListenQuiz,
    listenOpen,
    setListenOpen,
    listenCount,
    setListenCount,
    openListening,
    startListenQuestions,
    quizApiRef,
    listenApiRef,
  } = studyGroup
  closers.current.study = closeStudy
  closers.current.quiz = () => {
    setQuizSetupOpen(false)
    setQuizQueue(null)
  }
  closers.current.listen = () => setListenOpen(false)

  /** 理解题面板：听力模式 / 阅读理解（文本）模式。 */
  const [listenReadMode, setListenReadMode] = useState(false)
  const openListeningMode = useCallback(
    (read: boolean) => {
      setListenReadMode(read)
      openListening()
    },
    [openListening],
  )

  const openSpeedRead = useCallback(() => {
    if (!doc?.sentences.length) {
      flash('先打开一篇文章')
      return
    }
    closeSessions('study', 'quiz', 'quick', 'listen')
    setSpeedReadOpen(true)
  }, [doc, closeSessions, flash, setSpeedReadOpen])

  /** 用指定片段开一轮听写（错题本「重练听写」用）。 */
  const startDictItems = useCallback((items: { id: string; text: string }[]) => {
    dictApiRef.current?.startItems(items)
  }, [])

  const outputGroup = useQuickWritingBack({
    studyPool,
    library,
    persist,
    markStudied,
    recordActivity,
    flash,
    doc,
    selectedId,
    articleIdentity,
    articleTitle,
    setLastTask,
    askedWordsRef,
    askedIdsRef,
    backTranslations,
    saveBackTranslation,
    closeSessions,
  })
  const {
    quickApi,
    quickQueue,
    setQuickQueue,
    writingApi,
    writingOpen,
    setWritingOpen,
    writingModel,
    writingTask,
    setWritingTask,
    writingText,
    setWritingFeedback,
    writingHistory,
    setWritingHistory,
    openWriting,
    backApi,
    backOpen,
    openBack,
    closeQuick,
    closeWriting,
    closeBack,
    quickApiRef,
  } = outputGroup
  closers.current.quick = closeQuick
  closers.current.writing = closeWriting
  closers.current.back = closeBack

  // 听力理解题 / 仿写 / 回译：Esc 退出
  useHotkeys(
    (e) => {
      if (e.key === 'Escape') {
        closeSessions('listen', 'writing', 'back')
      }
    },
    listenOpen || writingOpen || backOpen,
    20,
  )

  const { vocabMode, vocabSeconds, toggleVocabMode, sessionPickedRef } = useVocabMode({ setSessions })

  const { retryMistakeVocab, retryMistakeListen, retryMistakeDict, startSiege } = useMistakeActions({
    mistakes,
    libraryItems: library.items,
    startQuizItems,
    startListenQuestions,
    startDictItems,
    setIntensiveOpen,
    setQuizLoopWrong,
    setQuizScope,
    flash,
  })

  const dictApi = useDictation({
    doc,
    articleIdentity,
    libraryLemmas: docLemmas,
    speak,
    warmTexts,
    warmTimings,
    flash,
    mergeBatch,
    batchItemsFromWords,
    recordActivity,
    recordPractice,
    recordAnswer,
    addMistake,
    dropMistake,
    closeOthers: () => closeSessions('study', 'quiz', 'quick'),
  })
  dictApiRef.current = dictApi
  closers.current.dictation = () => dictApiRef.current?.close()

  return {
    studyApi,
    studyQueue,
    studyPool,
    studyUnflushed,
    startStudy,
    closeStudy,
    quizApi,
    setQuizScope,
    setQuizLoopWrong,
    quizSetupOpen,
    setQuizSetupOpen,
    quizQueue,
    setQuizQueue,
    /** 「先学一遍再考」的预习卡（有它也算会话进行中，正文要让位） */
    quizWarmup: quizApi.warmup,
    quizIndex,
    quizArticleKinds,
    startArticleQuiz,
    startQuizItems,
    startQuizDrill,
    startQuizArticleDrill,
    listenApi,
    listenQuiz,
    setListenQuiz,
    listenOpen,
    setListenOpen,
    listenCount,
    setListenCount,
    openListening,
    startListenQuestions,
    listenReadMode,
    setListenReadMode,
    openListeningMode,
    openSpeedRead,
    startDictItems,
    quickApi,
    quickQueue,
    setQuickQueue,
    writingApi,
    writingOpen,
    setWritingOpen,
    writingModel,
    writingTask,
    setWritingTask,
    writingText,
    setWritingFeedback,
    writingHistory,
    setWritingHistory,
    openWriting,
    backApi,
    backOpen,
    openBack,
    vocabMode,
    vocabSeconds,
    toggleVocabMode,
    sessionPickedRef,
    retryMistakeVocab,
    retryMistakeListen,
    retryMistakeDict,
    startSiege,
    dictApi,
    listenApiRef,
    quizApiRef,
    quickApiRef,
    dictApiRef,
  }
}
