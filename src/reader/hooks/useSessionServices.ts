import { useCallback, useRef, useState } from 'react'
import type { MistakeEntry } from '../../core/mistakes'
import type { PickSession } from '../../core/vocabStats'
import type { BatchItemLike } from '../batchItem'
import { useDictation } from './useDictation'
import { useMistakeActions } from './useMistakeActions'
import { useQuickWritingBack, type UseQuickWritingBackParams } from './useQuickWritingBack'
import { useSessionClosers } from './useSessionClosers'
import { useStudyQuizListen, type UseStudyQuizListenParams } from './useStudyQuizListen'
import { useVocabMode } from './useVocabMode'
import { useHotkeys } from '../useHotkeys'

/** 学习组（背词 / 考试 / 听力）：`closeTransient` 由本 hook 注入。 */
type StudyParams = Omit<UseStudyQuizListenParams, 'closeTransient'>
/** 输出组（快刷 / 仿写 / 回译）：`studyPool` 与 `closeSessions` 由本 hook 注入。 */
type OutputParams = Omit<UseQuickWritingBackParams, 'studyPool' | 'closeSessions'>

/**
 * 本 hook 自己要用、但要由 ReaderApp 提供的四项。
 * 其余入参直接沿用两个子组 hook 的签名，不再手抄一遍（抄漏一处就是两份类型）。
 */
export interface UseSessionServicesParams extends StudyParams, OutputParams {
  mistakes: MistakeEntry[]
  setIntensiveOpen: (open: boolean) => void
  setSpeedReadOpen: (open: boolean) => void
  setSessions: (updater: (prev: PickSession[]) => PickSession[]) => void
  /** 听写要的音频预热与待选合并（其余听写入参直接从上面两组沿用）。 */
  warmTexts: (texts: string[]) => void
  warmTimings: (texts: string[]) => void
  mergeBatch: (items: BatchItemLike[]) => void
  batchItemsFromWords: (words: string[]) => BatchItemLike[]
}

/**
 * 所有「会话」服务的组装：学习组（背词/考试/听力）+ 快刷/听写 + 仿写/回译，
 * 外加选词计时与错题重练。
 *
 * 这一层只做装配：子状态机分别在学习组 / 输出组 hook 里；关闭注册表在
 * `useSessionClosers`（按组关闭的唯一规则）。开始一个会话只按组关闭，
 * 不再每个 closeOthers 手抄一遍。
 */
export function useSessionServices(params: UseSessionServicesParams) {
  const {
    doc,
    library,
    flash,
    setIntensiveOpen,
    setSpeedReadOpen,
    setSessions,
    mistakes,
  } = params

  const dictApiRef = useRef<ReturnType<typeof useDictation> | null>(null)
  const { closers, closeSessions, closeTransient } = useSessionClosers()

  const studyGroup = useStudyQuizListen({ ...params, closeTransient })
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

  const outputGroup = useQuickWritingBack({ ...params, studyPool, closeSessions })
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
    ...params,
    libraryLemmas: params.docLemmas,
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
