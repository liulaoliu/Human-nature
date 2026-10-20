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
 * 注意：传进来的是**本篇的普通单词条目**，不是整库。否则新文章会把
 * 总词库里恰好出现的 the / is / are 全标成生词。语言点也不参与正文高亮 / 编号。
 */
export interface UseDocVocabSetsParams {
  sentences: Pick<Sentence, 'id' | 'text'>[] | null
  /** 本篇条目（已过滤掌握 / 语言点） */
  articleItems: VocabItem[]
  /** 待选清单：指到过的句子也算「有待办」 */
  batchSentenceIds: Set<string>
}

export interface UseDocVocabSetsResult {
  /** 每句出现过的 lemma */
  sentenceLemmas: Map<string, Set<string>>
  /** 全文出现过的 lemma */
  docLemmas: Set<string>
  /** 本篇未掌握词条的词形/lemma（a·d 只在这些句间跳） */
  activeLemmas: Set<string>
  /** 本篇词条的词形/lemma（正文高亮用） */
  libraryLemmas: Set<string>
  /** 有生词的句子 id（正文顺序） */
  vocabSids: string[]
  /** 同上，Set 形态（面板判 class 用） */
  vocabSidSet: Set<string>
}

export function useDocVocabSets({ sentences, articleItems, batchSentenceIds }: UseDocVocabSetsParams): UseDocVocabSetsResult {
  const sentenceLemmas = useMemo(() => sentenceLemmaSets(sentences), [sentences])
  const docLemmas = useMemo(() => allLemmas(sentenceLemmas), [sentenceLemmas])
  const activeLemmas = useMemo(() => activeLemmasOf(articleItems), [articleItems])
  const libraryLemmas = useMemo(() => libraryLemmaSet(articleItems), [articleItems])
  const vocabSids = useMemo(
    () => vocabSentenceIds(sentences, sentenceLemmas, activeLemmas, batchSentenceIds),
    [sentences, sentenceLemmas, activeLemmas, batchSentenceIds],
  )
  const vocabSidSet = useMemo(() => new Set(vocabSids), [vocabSids])
  return { sentenceLemmas, docLemmas, activeLemmas, libraryLemmas, vocabSids, vocabSidSet }
}
