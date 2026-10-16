import { useMemo } from 'react'
import type { Sentence, VocabItem } from '../../types/document'
import {
  activeLemmasOf,
  allLemmas,
  libraryLemmaSet,
  sentenceLemmaSets,
  vocabSentenceIds,
} from '../../core/vocabSets'

/**
 * 「正文里哪些词算生词」的接线：一次算出高亮/编号/a·d 跳转要用的那几套集合。
 *
 * 抽成 hook 的原因：这几行互相依赖（句子 lemma → 全文 lemma → 有生词的句子），
 * 散在 ReaderApp 里既占地方又容易改错一处；规则本身在 core/vocabSets（已单测）。
 */
export interface UseDocVocabSetsParams {
  sentences: Pick<Sentence, 'id' | 'text'>[] | null
  /** 整库（用于「已在生词本里」提示） */
  items: VocabItem[]
  /** 待选清单：指到过的句子也算「有待办」 */
  batchSentenceIds: Set<string>
}

export interface UseDocVocabSetsResult {
  /** 每句出现过的 lemma */
  sentenceLemmas: Map<string, Set<string>>
  /** 全文出现过的 lemma */
  docLemmas: Set<string>
  /** 未掌握词条的词形/lemma（a·d 只在这些句间跳） */
  activeLemmas: Set<string>
  /** 全量词条的词形/lemma（「已在生词本里」用） */
  libraryLemmas: Set<string>
  /** 有生词的句子 id（正文顺序） */
  vocabSids: string[]
  /** 同上，Set 形态（面板判 class 用） */
  vocabSidSet: Set<string>
}

export function useDocVocabSets({ sentences, items, batchSentenceIds }: UseDocVocabSetsParams): UseDocVocabSetsResult {
  const sentenceLemmas = useMemo(() => sentenceLemmaSets(sentences), [sentences])
  const docLemmas = useMemo(() => allLemmas(sentenceLemmas), [sentenceLemmas])
  const activeLemmas = useMemo(() => activeLemmasOf(items), [items])
  const libraryLemmas = useMemo(() => libraryLemmaSet(items), [items])
  const vocabSids = useMemo(
    () => vocabSentenceIds(sentences, sentenceLemmas, activeLemmas, batchSentenceIds),
    [sentences, sentenceLemmas, activeLemmas, batchSentenceIds],
  )
  const vocabSidSet = useMemo(() => new Set(vocabSids), [vocabSids])
  return { sentenceLemmas, docLemmas, activeLemmas, libraryLemmas, vocabSids, vocabSidSet }
}
