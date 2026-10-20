import { useCallback } from 'react'
import type { MutableRefObject } from 'react'
import type { Sentence, VocabLibrary } from '../../types/document'
import { lemmaOf, markWord, removeItem } from '../../core/vocab'
import { splitGlossText } from '../../core/langPoints'
import type { BatchItem } from '../panels/SidePick'

export interface UseVocabEditsParams {
  /** 同步持有的最新词库（连续两次写入不会互相覆盖） */
  libraryRef: MutableRefObject<VocabLibrary>
  /** 唯一写入入口（`useVocabLibrary.persist`） */
  persist: (lib: VocabLibrary) => void
  /** 词条归属的当前文章 */
  article: { identity: string; title: string; key: string | null }
  flash: (message: string) => void
}

export interface UseVocabEditsResult {
  /** 把「待选」整批直接收进生词本（自动标词直入模式）。 */
  commitBatchItems: (items: BatchItem[]) => void
  /** 速读里手动加生词（可一次多个）。 */
  addItems: (items: { word: string; sentenceId: string | null; sentenceText: string }[]) => void
  /** 语言点里的词组 / 习语一键入库（`英文 — 中文` 拆成词条 + 释义）。 */
  addPhrases: (items: string[], sentence: Sentence | null) => void
  /** 把误加的词从生词本移出（两步确认在面板里做）。 */
  removeWord: (word: string) => void
}

/**
 * 词库的**增删动作**：都通过 `persist` 写，且以 `libraryRef.current` 为基准，
 * 避免同一次渲染里连续两次操作用同一份旧快照、后写覆盖先写。
 *
 * 读回 / 硬闸 / 快照仍在 `useVocabLibrary`；这里只负责「怎么改」。
 */
export function useVocabEdits({ libraryRef, persist, article, flash }: UseVocabEditsParams): UseVocabEditsResult {
  const articleId = article.title || article.key || '手动粘贴'
  const fileName = article.identity

  const commitBatchItems = useCallback(
    (items: BatchItem[]) => {
      const valid = items.filter((it) => it.word.trim())
      if (!valid.length) return
      let lib = libraryRef.current
      for (const it of valid) {
        lib = markWord(lib, {
          word: it.word,
          articleId,
          fileName,
          sentenceId: it.sentenceId,
          sentenceText: it.sentence,
        }).library
      }
      persist(lib)
    },
    [libraryRef, persist, articleId, fileName],
  )

  const addItems = useCallback(
    (items: { word: string; sentenceId: string | null; sentenceText: string }[]) => {
      const list = items.map((it) => ({ ...it, word: it.word.trim() })).filter((it) => it.word)
      if (!list.length) return
      let lib = libraryRef.current
      let created = 0
      for (const it of list) {
        const r = markWord(lib, {
          word: it.word,
          articleId,
          fileName,
          sentenceId: it.sentenceId,
          sentenceText: it.sentenceText,
        })
        lib = r.library
        if (r.created) created++
      }
      persist(lib)
      const names = list.map((it) => it.word).join('、')
      flash(created ? `已加入 ${created} 个生词：${names}` : `已在生词本：${names}`)
    },
    [libraryRef, persist, flash, articleId, fileName],
  )

  const addPhrases = useCallback(
    (items: string[], sentence: Sentence | null) => {
      if (!items.length) return
      let lib = libraryRef.current
      let created = 0
      for (const raw of items) {
        const { word, gloss } = splitGlossText(raw)
        if (!word) continue
        const r = markWord(lib, {
          word,
          articleId,
          fileName,
          sentenceId: sentence?.id ?? null,
          sentenceText: sentence?.text ?? '',
          meaning: gloss,
        })
        lib = r.library
        if (r.created) created++
      }
      persist(lib)
      flash(
        created
          ? `已加入 ${created} 个词组 / 习语${created < items.length ? '（其余已在生词本）' : ''}`
          : '这些词组 / 习语都已在生词本里（语言点会自动收藏）',
      )
    },
    [libraryRef, persist, flash, articleId, fileName],
  )

  const removeWord = useCallback(
    (word: string) => {
      const lem = lemmaOf(word)
      const lib = libraryRef.current
      const item = lib.items.find((it) => it.lemma === lem)
      if (!item) {
        flash(`不在生词本：${word}`)
        return
      }
      persist(removeItem(lib, item.id))
      flash(`已移出生词本：${item.word}`)
    },
    [libraryRef, persist, flash],
  )

  return { commitBatchItems, addItems, addPhrases, removeWord }
}
