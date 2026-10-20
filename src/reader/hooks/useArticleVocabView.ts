import { useCallback, useMemo } from 'react'
import type { ArticleVocabEntry, Sentence, VocabLibrary, VocabOrigin, VocabVia } from '../../types/document'
import { articleEntryViews } from '../../core/articleVocab'
import { articleNumbering } from '../../core/articleNums'
import { resolveArticleMeaning } from '../../core/articleMeaning'
import { displayMeaning, lemmaOf } from '../../core/vocab'
import { wordSpans } from '../../core/wordSelect'
import { hasSentenceLanguage } from '../../core/language'

/**
 * 「本篇生词」这一组派生值：哪些词算本篇的、编号多少、自动/手动、语境释义、
 * 哪些句子里有语言点、有没有全部打印过。
 *
 * 口径（只在这里实现一次）：
 *   1. 本篇只认 `articleEntries` 里显式收进这一篇的词；新文章不从总词库继承；
 *   2. 已掌握的不显示；编号只给普通单词，语言点仍可在「语言点」页签看到；
 *   3. 编号按加入顺序（`core/articleNums`），删除后自动紧凑；
 *   4. 打印状态按篇条目算，不拿全库 item.lastPrintedAt 冒充。
 */
export interface ArticleVocabInput {
  library: VocabLibrary
  /** 本篇的稳定标识（`articleKey ?? savedId ?? articleTitle`） */
  articleIdentity: string
  /** 本篇句子（没加载时为 null） */
  sentences: Sentence[] | null
}

export function useArticleVocabView({ library, articleIdentity, sentences }: ArticleVocabInput) {
  /** 普通单词：参与正文编号 / 复习 / 速读已收录判断 */
  const wordViews = useMemo(
    () => articleEntryViews(library, articleIdentity),
    [library, articleIdentity],
  )
  /** 全部条目（含词组 / 习语 / 用法）：侧栏语言点页签、按篇打印要看到 */
  const allViews = useMemo(
    () => articleEntryViews(library, articleIdentity, true),
    [library, articleIdentity],
  )
  const entries = useMemo(() => wordViews.map((v) => v.entry), [wordViews])
  const articleWords = useMemo(() => allViews.map((v) => v.item), [allViews])
  const articleWordItems = useMemo(() => wordViews.map((v) => v.item), [wordViews])
  const entryByLemma = useMemo(
    () => new Map(allViews.map((v) => [v.entry.lemma, v.entry])),
    [allViews],
  )

  /** 本篇已收录的单词原形（速读里标记「已收录」/ 禁用快捷加词；全库不算） */
  const knownLemmas = useMemo(() => new Set(articleWordItems.map((it) => it.lemma)), [articleWordItems])

  /** 本篇自动 / 手动标签（含语言点） */
  const articleOrigins = useMemo(
    () => new Map<string, VocabOrigin>(allViews.map((v) => [v.entry.lemma, v.entry.origin])),
    [allViews],
  )

  /** 本篇细分来源（AI / 词典 / 手动 / 语言点；旧条目可能没有） */
  const articleVias = useMemo(
    () =>
      new Map<string, VocabVia>(
        allViews.flatMap((v) => (v.entry.via ? [[v.entry.lemma, v.entry.via] as const] : [])),
      ),
    [allViews],
  )

  /** 本篇已有语言点的句子数（侧栏显示用） */
  const languageSentCount = useMemo(
    () => (sentences ?? []).filter((s) => hasSentenceLanguage(s)).length,
    [sentences],
  )

  /** 某一句里有哪些「本篇已收录」的词（速读的「本句已在生词本」用） */
  const wordsBySentence = useMemo(() => {
    const map = new Map<string, Set<string>>()
    for (const s of sentences ?? []) {
      const set = new Set<string>()
      for (const w of wordSpans(s.text)) set.add(lemmaOf(w.text))
      map.set(s.id, set)
    }
    return map
  }, [sentences])
  const wordsInSentence = useCallback(
    (sid: string) => {
      const lemmas = wordsBySentence.get(sid)
      if (!lemmas) return []
      return articleWordItems.filter((it) => lemmas.has(it.lemma)).map((it) => it.word)
    },
    [articleWordItems, wordsBySentence],
  )

  /** 本篇生词编号（规则在 core/articleNums，已单测） */
  const { nums: articleNums, firstOccurrence: articleFirst } = useMemo(
    () => articleNumbering(sentences, entries),
    [sentences, entries],
  )

  /** 悬浮 / 列表释义：本篇语境优先，全库主释义兜底 */
  const meaningOf = useCallback(
    (word: string, sentenceId?: string | null) => {
      const lemma = lemmaOf(word)
      const item = articleWords.find((it) => it.lemma === lemma)
      if (!item) return null
      const entry: ArticleVocabEntry | undefined = entryByLemma.get(item.lemma)
      const resolved = resolveArticleMeaning(item, entry, articleIdentity, sentenceId)
      return resolved ? displayMeaning({ partOfSpeech: item.partOfSpeech, meaning: resolved.text }) || resolved.text : null
    },
    [articleWords, entryByLemma, articleIdentity],
  )

  /** 最近一次打印时间（按篇条目的 printedAt） */
  const articlePrintedAt = useMemo(() => {
    let latest: string | null = null
    for (const v of allViews) {
      const at = v.entry.printedAt
      if (at && (!latest || at > latest)) latest = at
    }
    return latest
  }, [allViews])

  /** 本篇生词是否全部打印过（空集不算「都打印了」） */
  const articleAllPrinted = entries.length > 0 && entries.every((e) => !!e.printedAt)

  /** lemma → 条目（外部需要改语境释义时用） */
  const articleEntryLookup = useCallback(
    (lemma: string) => entryByLemma.get(lemma) ?? null,
    [entryByLemma],
  )

  return {
    articleWords,
    articleWordItems,
    articleEntries: entries,
    articleEntryLookup,
    knownLemmas,
    articleOrigins,
    articleVias,
    languageSentCount,
    wordsInSentence,
    articleNums,
    articleFirst,
    meaningOf,
    articlePrintedAt,
    articleAllPrinted,
  }
}
