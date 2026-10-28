import { useRef, type MutableRefObject } from 'react'
import type { ActivityCat } from '../../core/activity'
import type { AnswerEventInput } from '../../core/answerEvents'
import type { PracticeKind } from '../../core/practice'
import type { MistakeEntry } from '../../core/mistakes'
import type { VocabLibrary } from '../../types/document'
import type { ReaderDoc } from './useReaderDoc'
import type { AiTaskKey } from './aiTasks'
import { useStudySession } from './useStudySession'
import { useQuizSession } from './useQuizSession'
import { useListening } from './useListening'

export interface UseStudyQuizListenParams {
  library: VocabLibrary
  articleIdentity: string
  docLemmas: Set<string>
  doc: ReaderDoc | null
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
  /** 关掉同组之外的临时会话（快刷 / 听写）；由父层注入。 */
  closeTransient: () => void
}

/** 学习组：背词 / 考试 / 听力理解；组内开始一个会先关掉同组其它会话。 */
export function useStudyQuizListen({
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
}: UseStudyQuizListenParams) {
  const quizApiRef = useRef<ReturnType<typeof useQuizSession> | null>(null)
  const listenApiRef = useRef<ReturnType<typeof useListening> | null>(null)

  const studyApi = useStudySession({
    library,
    articleIdentity,
    docLemmas,
    closeQuiz: () => quizApiRef.current?.forceClose(),
    flash,
    persist,
    markStudied,
    recordActivity,
    addStudyTime: studyFlush,
    speak,
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
    onRelearn: (ids) => studyApi.startRelearn(ids),
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
      closeTransient()
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
    quizApiRef,
    listenApiRef,
  }
}
