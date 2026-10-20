import { useCallback, useRef, useState } from 'react'
import type { MutableRefObject } from 'react'
import type { ActivityCat } from '../../core/activity'
import type { AnswerEventInput } from '../../core/answerEvents'
import type { PracticeKind } from '../../core/practice'
import type { MistakeEntry } from '../../core/mistakes'
import type { VocabLibrary } from '../../types/document'
import type { ReaderDoc } from './useReaderDoc'
import type { AiTaskKey } from './useAiTasks'
import { useStudySession } from './useStudySession'
import { useQuizSession } from './useQuizSession'
import { useListening } from './useListening'
import { useQuickSession } from './useQuickSession'
import { useDictation } from './useDictation'
import { useWriting } from './useWriting'
import { useVocabMode } from './useVocabMode'
import { useMistakeActions } from './useMistakeActions'
import { useHotkeys } from '../useHotkeys'
import type { PickSession } from '../../core/vocabStats'

type BatchItemLike = { word: string; sentence: string; sentenceId: string | null }

export interface UseSessionServicesParams {
  library: VocabLibrary
  articleIdentity: string
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
}

/**
 * 所有「会话」服务的组装：背词 / 考试 / 听力 / 快刷 / 听写 / 仿写，外加选词计时与错题重练。
 *
 * 这些 hook 之间有先后与互斥关系（开始一个先关掉其它），原来这段接线在 `ReaderApp`
 * 里占两百多行；收进一个服务层后，页面只拿结果、不再关心 ref 顺序。
 */
export function useSessionServices({
  library,
  articleIdentity,
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
}: UseSessionServicesParams) {
  const quizApiRef = useRef<ReturnType<typeof useQuizSession> | null>(null)
  const quickApiRef = useRef<ReturnType<typeof useQuickSession> | null>(null)
  const dictApiRef = useRef<ReturnType<typeof useDictation> | null>(null)
  const listenApiRef = useRef<ReturnType<typeof useListening> | null>(null)

  const studyApi = useStudySession({
    library,
    articleIdentity,
    docLemmas,
    closeQuiz: () => quizApiRef.current?.close(),
    flash,
    persist,
    markStudied,
    recordActivity,
    addStudyTime: studyFlush,
    newLimit,
    newToday,
    onBumpNewToday: bumpNewToday,
  })
  const {
    queue: studyQueue,
    pool: studyPool,
    unflushedSeconds: studyUnflushed,
    start: startStudy,
    close: closeStudy,
  } = studyApi

  const quizApi = useQuizSession({
    library,
    articleIdentity,
    docLemmas,
    doc,
    closeOthers: () => closeStudy(),
    speak,
    flash,
    persist,
    markStudied,
    recordActivity,
    recordPractice,
    recordAnswer,
    addMistake,
    dropMistake,
    onKinds: mergeKindStats,
  })
  quizApiRef.current = quizApi
  const {
    setScope: setQuizScope,
    setLoopWrong: setQuizLoopWrong,
    setupOpen: quizSetupOpen,
    setSetupOpen: setQuizSetupOpen,
    queue: quizQueue,
    setQueue: setQuizQueue,
    index: quizIndex,
    articleKinds: quizArticleKinds,
    startArticle: startArticleQuiz,
    startItems: startQuizItems,
    startDrill: startQuizDrill,
    startArticleDrill: startQuizArticleDrill,
  } = quizApi

  const listenApi = useListening({
    doc,
    articleIdentity,
    flash,
    setLastTask,
    askedWordsRef,
    askedIdsRef,
    recordActivity,
    recordPractice,
    recordAnswer,
    addMistake,
    dropMistake,
    closeOthers: () => {
      closeStudy()
      setQuizSetupOpen(false)
      setQuizQueue(null)
      quickApiRef.current?.close()
      dictApiRef.current?.close()
    },
  })
  listenApiRef.current = listenApi
  const {
    quiz: listenQuiz,
    setQuiz: setListenQuiz,
    open: listenOpen,
    setOpen: setListenOpen,
    count: listenCount,
    setCount: setListenCount,
    start: openListening,
    startQuestions: startListenQuestions,
  } = listenApi

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
    closeStudy()
    setQuizSetupOpen(false)
    setQuizQueue(null)
    setQuickQueue(null)
    setListenOpen(false)
    setSpeedReadOpen(true)
  }, [doc, closeStudy, flash, setQuizSetupOpen, setListenOpen, setSpeedReadOpen])

  /** 用指定片段开一轮听写（错题本「重练听写」用）。 */
  const startDictItems = useCallback((items: { id: string; text: string }[]) => {
    dictApiRef.current?.startItems(items)
  }, [])

  const quickApi = useQuickSession({
    studyPool,
    library,
    persist,
    markStudied,
    recordActivity,
    flash,
    closeOthers: () => {
      closeStudy()
      setQuizSetupOpen(false)
      setQuizQueue(null)
    },
  })
  quickApiRef.current = quickApi
  const { queue: quickQueue, setQueue: setQuickQueue } = quickApi

  const writingApi = useWriting({
    doc,
    selectedId,
    flash,
    setLastTask,
    askedWordsRef,
    askedIdsRef,
    closeOthers: () => {
      closeStudy()
      setQuizSetupOpen(false)
      setQuizQueue(null)
      quickApiRef.current?.close()
      dictApiRef.current?.close()
      setListenOpen(false)
    },
  })
  const {
    open: writingOpen,
    setOpen: setWritingOpen,
    model: writingModel,
    task: writingTask,
    setTask: setWritingTask,
    text: writingText,
    setFeedback: setWritingFeedback,
    history: writingHistory,
    setHistory: setWritingHistory,
    start: openWriting,
  } = writingApi

  // 听力理解题 / 仿写：Esc 退出
  useHotkeys(
    (e) => {
      if (e.key === 'Escape') {
        setListenOpen(false)
        setWritingOpen(false)
      }
    },
    listenOpen || writingOpen,
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
    closeOthers: () => {
      closeStudy()
      setQuizSetupOpen(false)
      setQuizQueue(null)
      setQuickQueue(null)
    },
  })
  dictApiRef.current = dictApi

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
