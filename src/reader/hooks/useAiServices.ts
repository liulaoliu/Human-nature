import { useMemo } from 'react'
import type { MutableRefObject } from 'react'
import type { AiJobsInput } from '../../core/aiPackage'
import type { Sentence, VocabItem, VocabLibrary } from '../../types/document'
import type { AiTaskKey } from './useAiTasks'
import type { ReaderDoc } from './useReaderDoc'
import { useAiTasks } from './useAiTasks'
import { useApplyTaskResult } from './useApplyTaskResult'
import { useAiPack } from './useAiPack'
import { usePasteApply } from './usePasteApply'

type BatchItemLike = { word: string; sentence: string; sentenceId: string | null }
type ApplyP = Parameters<typeof useApplyTaskResult>[0]
type TaskP = Parameters<typeof useAiTasks>[0]
type PasteP = Parameters<typeof usePasteApply>[0]

export interface UseAiServicesParams {
  exact: string
  useExact: boolean
  sentence: Sentence | null
  visibleBatch: BatchItemLike[]
  library: VocabLibrary
  libraryRef: MutableRefObject<VocabLibrary>
  persist: (library: VocabLibrary) => void
  articleIdentity: string
  articleTitle: string
  articleKey: string | null
  doc: ReaderDoc | null
  vocabLevel: TaskP['vocabLevel']
  confusableBatch: VocabItem[]
  confusableTodo: VocabItem[]
  lemmaCandidates: TaskP['lemmaCandidates']
  posCandidates: TaskP['posCandidates']
  articleWords: VocabItem[]
  flash: (message: string) => void
  setLastTask: (task: AiTaskKey) => void
  setBatch: TaskP['setBatch']
  askedWordsRef: MutableRefObject<string[]>
  askedIdsRef: MutableRefObject<string[]>
  pasteMissing: TaskP['pasteMissing']
  mergeBatch: (items: BatchItemLike[]) => void
  batchItemsFromWords: (words: string[]) => BatchItemLike[]
  autoVocabDirect: boolean
  commitBatchItems: (items: BatchItemLike[]) => void
  writingModel: string
  writingText: string
  writingTask: ApplyP['writingTask']
  recordActivity: ApplyP['recordActivity']
  setDoc: ApplyP['setDoc']
  setPendingSave: ApplyP['setPendingSave']
  setListenQuiz: ApplyP['setListenQuiz']
  setWritingTask: ApplyP['setWritingTask']
  setWritingFeedback: ApplyP['setWritingFeedback']
  setWritingHistory: ApplyP['setWritingHistory']
  download: (name: string, content: string, mime: string) => void
  aiPackScope: 'article' | 'all'
  confusableBatchSize: number
  listenQuiz: { questions: unknown[] } | null
  listenCount: number
  pasted: string
  clearPasted: () => void
  lastTask: PasteP['lastTask']
  onReport: (lines: string[]) => void
  onMissing: PasteP['onMissing']
}

/**
 * AI 相关服务：复制提示词、应用粘回结果、AI 工作包（本机 agent / 网页版）。
 *
 * 四块原来在 `ReaderApp` 里靠一个 40 行的 `aiJobsInput` 串起来；现在输入推导、
 * 结果应用和粘贴路由都在这里，页面只拿按钮要用的函数。
 */
export function useAiServices({
  exact,
  useExact,
  sentence,
  visibleBatch,
  library,
  libraryRef,
  persist,
  articleIdentity,
  articleTitle,
  articleKey,
  doc,
  vocabLevel,
  confusableBatch,
  confusableTodo,
  lemmaCandidates,
  posCandidates,
  articleWords,
  flash,
  setLastTask,
  setBatch,
  askedWordsRef,
  askedIdsRef,
  pasteMissing,
  mergeBatch,
  batchItemsFromWords,
  autoVocabDirect,
  commitBatchItems,
  writingModel,
  writingText,
  writingTask,
  recordActivity,
  setDoc,
  setPendingSave,
  setListenQuiz,
  setWritingTask,
  setWritingFeedback,
  setWritingHistory,
  download,
  aiPackScope,
  confusableBatchSize,
  listenQuiz,
  listenCount,
  pasted,
  clearPasted,
  lastTask,
  onReport,
  onMissing,
}: UseAiServicesParams) {
  const aiTasksApi = useAiTasks({
    exact,
    useExact,
    sentence,
    visibleBatch,
    library,
    persist,
    articleIdentity,
    articleTitle,
    articleKey,
    doc,
    vocabLevel,
    confusableBatch,
    confusableTodo,
    lemmaCandidates,
    posCandidates,
    flash,
    setLastTask,
    setBatch,
    askedWordsRef,
    askedIdsRef,
    pasteMissing,
  })

  const applyTaskResult = useApplyTaskResult({
    library,
    libraryRef,
    sentence,
    persist,
    mergeBatch,
    batchItemsFromWords,
    autoVocabDirect,
    commitBatchItems,
    articleTitle,
    articleKey,
    articleIdentity,
    writingModel,
    writingText,
    writingTask,
    recordActivity,
    ecdictLevel: vocabLevel,
    articleText: (doc?.sentences ?? []).map((s) => s.text).join(' '),
    sentenceForWord: (word) => {
      const it = batchItemsFromWords([word])[0]
      return { sentence: it?.sentence ?? '', sentenceId: it?.sentenceId ?? null }
    },
    setDoc,
    setPendingSave,
    setListenQuiz,
    setWritingTask,
    setWritingFeedback,
    setWritingHistory,
  })

  /** 由当前数据推导 AI 待办（纯逻辑在 core/aiPackage，便于单测）。 */
  const aiJobsInput = useMemo<AiJobsInput>(
    () => ({
      batch: visibleBatch.map((b) => ({ word: b.word, sentence: b.sentence })),
      items: library.items,
      articleWords,
      scope: aiPackScope,
      confusableBatchSize,
      articleId: articleIdentity,
      sentences: doc?.sentences ?? [],
      vocabLevel,
      hasListenQuiz: !!listenQuiz,
      listenCount,
    }),
    [
      visibleBatch,
      library,
      articleWords,
      aiPackScope,
      confusableBatchSize,
      articleIdentity,
      doc,
      vocabLevel,
      listenQuiz,
      listenCount,
    ],
  )

  const aiPack = useAiPack({
    jobsInput: aiJobsInput,
    applyTaskResult,
    download,
    flash,
    onReport,
  })

  const {
    applyWeb: applyAiWeb,
    webPending: aiWebPending,
    localRunning: aiLocalRunning,
    localDone: aiLocalDone,
    localTotal: aiLocalTotal,
    localRound: aiLocalRound,
    localPhase: aiLocalPhase,
    localError: aiLocalError,
    runLocal: runAiLocal,
  } = aiPack

  const { applyAnyPaste } = usePasteApply({
    pasted,
    clearPasted,
    lastTask,
    applyTaskResult,
    askedWordsRef,
    askedIdsRef,
    onReport,
    onMissing,
    applyAiWeb,
    flash,
  })

  return {
    aiTasksApi,
    applyTaskResult,
    aiPack,
    applyAiWeb,
    aiWebPending,
    aiLocalRunning,
    aiLocalDone,
    aiLocalTotal,
    aiLocalRound,
    aiLocalPhase,
    aiLocalError,
    runAiLocal,
    applyAnyPaste,
  }
}
