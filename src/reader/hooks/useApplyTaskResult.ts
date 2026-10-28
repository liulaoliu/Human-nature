import { useMemo } from 'react'
import { createApplyTaskResult } from '../apply/createApplyTaskResult'
import type { ApplyTaskFn, ApplyTaskParams } from '../apply/types'

export type { ApplyOutcome } from '../apply/types'
export type UseApplyTaskResultParams = ApplyTaskParams

/**
 * AI 结果应用器的 React 接线条：逻辑在 `reader/apply/createApplyTaskResult`。
 * 这里只负责保持函数身份，避免每次渲染都换一个回调把下游 effect 带跑。
 */
export function useApplyTaskResult(params: UseApplyTaskResultParams): ApplyTaskFn {
  const {
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
    doc,
    listeningKey,
    writingModel,
    writingText,
    writingTask,
    recordActivity,
    ecdictLevel,
    articleText,
    sentenceForWord,
    setDoc,
    setPendingSave,
    setListenQuiz,
    setWritingTask,
    setWritingFeedback,
    setWritingHistory,
  } = params

  return useMemo(
    () => createApplyTaskResult(params),
    [
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
      doc,
      listeningKey,
      writingModel,
      writingText,
      writingTask,
      recordActivity,
      ecdictLevel,
      articleText,
      sentenceForWord,
      setDoc,
      setPendingSave,
      setListenQuiz,
      setWritingTask,
      setWritingFeedback,
      setWritingHistory,
    ],
  )
}
