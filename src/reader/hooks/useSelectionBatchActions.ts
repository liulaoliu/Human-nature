import { useCallback, type MouseEvent, type MutableRefObject } from 'react'
import { lemmaOf, markWord } from '../../core/vocab'
import type { Sentence, VocabLibrary } from '../../types/document'
import type { BatchItemLike } from '../batchItem'

export interface UseSelectionBatchActionsParams {
  exact: string
  batch: BatchItemLike[]
  addToBatch: (words: string[], sentence: string, sentenceId: string | null) => void
  sentence: Sentence | null
  vocabMode: boolean
  library: VocabLibrary
  persist: (library: VocabLibrary) => void
  articleIdentity: string
  articleTitle: string
  articleKey: string | null
  flash: (message: string) => void
  sessionPickedRef: MutableRefObject<number>
  rightDownRef: MutableRefObject<boolean>
  setLastPicked: (v: { word: string; sid: string } | null) => void
  setSelSid: (v: string | null) => void
  setSelIndices: (v: number[]) => void
}

/** 划词后的动作：加待选、选词模式右键、直接入库（不查词）。 */
export function useSelectionBatchActions({
  exact,
  batch,
  addToBatch,
  sentence,
  vocabMode,
  library,
  persist,
  articleIdentity,
  articleTitle,
  articleKey,
  flash,
  sessionPickedRef,
  rightDownRef,
  setLastPicked,
  setSelSid,
  setSelIndices,
}: UseSelectionBatchActionsParams) {
  /** 把当前精确选区（可能是离散拼成的词组）加入待选。 */
  const addSelectionToBatch = useCallback(() => {
    const word = exact.trim()
    if (!word) return
    const already = batch.some((x) => lemmaOf(x.word) === lemmaOf(word))
    addToBatch([word], sentence?.text ?? '', sentence?.id ?? null)
    if (!already) sessionPickedRef.current += 1
    if (sentence) setLastPicked({ word, sid: sentence.id })
    setSelSid(null)
    setSelIndices([])
    flash(`已加入待选：${word}`)
  }, [exact, batch, addToBatch, sentence, flash, sessionPickedRef, setLastPicked, setSelSid, setSelIndices])

  // 选词模式下右键 = 「加入待选」（屏蔽浏览器菜单，有精确选区才加入）
  const onContextMenu = useCallback(
    (e: MouseEvent<HTMLElement>) => {
      rightDownRef.current = false
      if (!vocabMode) return
      e.preventDefault()
      if (!exact.trim()) return
      addSelectionToBatch()
    },
    [vocabMode, exact, addSelectionToBatch, rightDownRef],
  )

  /** 不查词，直接把当前选中存进生词本（状态：未查）。 */
  const mark = useCallback(() => {
    if (!exact) {
      flash('先划一个单词（按住 Ctrl 可精确选词组）')
      return
    }
    const result = markWord(library, {
      word: exact,
      articleId: articleTitle || articleKey || '手动粘贴',
      fileName: articleIdentity,
      sentenceId: sentence?.id ?? null,
      sentenceText: sentence?.text ?? '',
      via: 'manual',
    })
    persist(result.library)
    flash(result.created ? `已加入：${result.item.word}` : `已合并：${result.item.word}`)
  }, [exact, library, articleIdentity, articleTitle, articleKey, sentence, persist, flash])

  return { addSelectionToBatch, onContextMenu, mark }
}
