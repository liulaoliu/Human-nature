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
    // 下面把 `ApplyTaskParams` 的每个字段逐个列出（不能直接依赖 `params`：调用方每次渲染
    // 都新建对象，会让这个回调每次换身份）。**给类型加字段时必须同步加到这里**，
    // 否则新字段改了不会重建，等于拿旧闭包跑。
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
