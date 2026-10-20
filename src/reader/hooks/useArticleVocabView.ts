import { useCallback, useMemo } from 'react'
import { articleWordsOf } from '../../core/vocab'
import { articleNumbering } from '../../core/articleNums'
import { hasSentenceLanguage } from '../../core/language'
import type { Sentence, VocabLibrary } from '../../types/document'

/**
 * 「本篇生词」这一组派生值：哪些词算本篇的、编号多少、哪些句子里有语言点、
 * 有没有全部打印过。
 *
 * 从 `ReaderApp` 抽出来是因为这里有两条**容易写错的口径**：
 *   1. 本篇生词 = 「来源是本文」**或**「本文正文里出现过该词」——
 *      只按 `source` 过滤的话，从别的文章带过来的同一个词永远不算本篇的；
 *   2. 编号/首次出现位置走 `core/articleNums`（有单测），视图不许另算一份。
 * 两条口径都在这一个地方，改的时候不用在装配层里找。
 */
export interface ArticleVocabInput {
  /** 词库（`library`，要 items 与来源信息） */
  library: VocabLibrary
  /** 本篇的稳定标识（`articleKey ?? savedId ?? articleTitle`） */
  articleIdentity: string
  /** 本篇每句的 lemma 集合（`useDocVocabSets`） */
  docLemmas: Set<string>
  /** 本篇句子（没加载时为 null） */
  sentences: Sentence[] | null
}

export function useArticleVocabView({ library, articleIdentity, docLemmas, sentences }: ArticleVocabInput) {
  const items = library.items

  /** 本篇生词：来源是本文，或本文正文里出现过该词（见上面第 1 条口径） */
  const articleWords = useMemo(
    () => articleWordsOf(library, articleIdentity, docLemmas),
    [library, articleIdentity, docLemmas],
  )

  /** 生词本已有原形集合（速读里标记「已收录」） */
  const knownLemmas = useMemo(() => new Set(items.map((it) => it.lemma)), [items])

  /** 本篇已有语言点的句子数（侧栏显示用） */
  const languageSentCount = useMemo(
    () => (sentences ?? []).filter((s) => hasSentenceLanguage(s)).length,
    [sentences],
  )

  /** 某一句来源的词条（含短语）：速读的「本句已在生词本」用 */
  const wordsInSentence = useCallback(
    (sid: string) =>
      items
        .filter((it) => it.source?.fileName === articleIdentity && it.source.sentenceId === sid)
        .map((it) => it.word),
    [items, articleIdentity],
  )

  /** 本篇生词编号（规则在 core/articleNums，已单测） */
  const { nums: articleNums, firstOccurrence: articleFirst } = useMemo(
    () => articleNumbering(sentences, articleWords),
    [sentences, articleWords],
  )

  /** 最近一次打印时间（「上次打印」提示用） */
  const articlePrintedAt = useMemo(() => {
    let latest: string | null = null
    for (const it of articleWords) {
      if (it.lastPrintedAt && (!latest || it.lastPrintedAt > latest)) latest = it.lastPrintedAt
    }
    return latest
  }, [articleWords])

  /** 本篇生词是否全部打印过（「不用重复打印」提示用） */
  const articleAllPrinted = articleWords.length > 0 && articleWords.every((it) => !!it.lastPrintedAt)

  return {
    articleWords,
    knownLemmas,
    languageSentCount,
    wordsInSentence,
    articleNums,
    articleFirst,
    articlePrintedAt,
    articleAllPrinted,
  }
}
