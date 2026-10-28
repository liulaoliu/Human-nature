import { useRef, type MutableRefObject } from 'react'
import type { ActivityCat } from '../../core/activity'
import type { VocabLibrary } from '../../types/document'
import type { ReaderDoc } from './useReaderDoc'
import type { AiTaskKey } from './aiTasks'
import type { BackTranslationRecord } from '../../core/backTranslate'
import type { useStudyPool } from './useStudyPool'
import { useQuickSession } from './useQuickSession'
import { useWriting } from './useWriting'
import { useBackTranslate } from './useBackTranslate'
import type { SessionKey } from './sessionKeys'

export interface UseQuickWritingBackParams {
  studyPool: ReturnType<typeof useStudyPool>['pool']
  library: VocabLibrary
  persist: (library: VocabLibrary) => void
  markStudied: (itemId: string) => void
  recordActivity: (cat: ActivityCat, n?: number) => void
  flash: (message: string) => void
  doc: ReaderDoc | null
  selectedId: string | null
  articleIdentity: string
  articleTitle: string
  setLastTask: (task: AiTaskKey) => void
  askedWordsRef: MutableRefObject<string[]>
  askedIdsRef: MutableRefObject<string[]>
  backTranslations: BackTranslationRecord[]
  saveBackTranslation: (rec: BackTranslationRecord) => void
  closeSessions: (...keys: SessionKey[]) => void
}

/** 快练 / 输出组：快刷、仿写、回译；各自开始前按组关闭上游会话。 */
export function useQuickWritingBack({
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
}: UseQuickWritingBackParams) {
  const quickApiRef = useRef<ReturnType<typeof useQuickSession> | null>(null)

  const quickApi = useQuickSession({
    studyPool,
    library,
    persist,
    markStudied,
    recordActivity,
    flash,
    closeOthers: () => closeSessions('study', 'quiz'),
  })
  quickApiRef.current = quickApi
  const { queue: quickQueue, setQueue: setQuickQueue } = quickApi
  const closeQuick = () => {
    quickApiRef.current?.close()
    setQuickQueue(null)
  }

  const writingApi = useWriting({
    doc,
    selectedId,
    flash,
    setLastTask,
    askedWordsRef,
    askedIdsRef,
    closeOthers: () => closeSessions('study', 'quiz', 'quick', 'dictation', 'listen'),
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
  const closeWriting = () => setWritingOpen(false)

  const backApi = useBackTranslate({
    doc,
    selectedId,
    articleIdentity,
    articleTitle,
    history: backTranslations,
    saveRecord: saveBackTranslation,
    recordActivity,
    flash,
    closeOthers: () => closeSessions('study', 'quiz', 'quick', 'dictation', 'listen', 'writing'),
  })
  const { open: backOpen, start: openBack } = backApi
  const closeBack = () => backApi.close()

  return {
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
  }
}
