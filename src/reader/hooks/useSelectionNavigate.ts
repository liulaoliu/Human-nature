import { useCallback, type MutableRefObject, type RefObject } from 'react'
import { wordSpans } from '../../core/wordSelect'
import { lemmaOf } from '../../core/vocab'
import type { Sentence, VocabItem, VocabLibrary } from '../../types/document'
import { visibleSidNode } from './selectionDom'

export interface UseSelectionNavigateParams {
  doc: { sentences: Sentence[] } | null
  articleIdentity: string
  articleTitle: string
  articleKey: string | null
  library: VocabLibrary
  persist: (library: VocabLibrary) => void
  flash: (message: string) => void
  peekSid: string | null
  selectedId: string | null
  setPeekSid: (v: string | null) => void
  setFocusLemma: (v: string | null) => void
  articleRef: RefObject<HTMLElement | null>
  sideRef: RefObject<HTMLElement | null>
  navVocabRef: MutableRefObject<(dir: 1 | -1) => void>
}

/** 正文定位：点生词高亮、滚到某句、从生词本回原文、A/D 逐句移动。 */
export function useSelectionNavigate({
  doc,
  articleIdentity,
  articleTitle,
  articleKey,
  library,
  persist,
  flash,
  peekSid,
  selectedId,
  setPeekSid,
  setFocusLemma,
  articleRef,
  sideRef,
  navVocabRef,
}: UseSelectionNavigateParams) {
  /** 点正文里的生词 → 高亮并滚到生词本对应词条。 */
  const focusEntry = useCallback(
    (word: string) => {
      const key = lemmaOf(word)
      setFocusLemma(key)
      // 调用方通常会先切到「生词本」Tab；用双 rAF 等 React 提交 + 布局完成后再滚，
      // 否则目标元素可能还是 display:none，scrollIntoView 会静默失败。
      window.requestAnimationFrame(() =>
        window.requestAnimationFrame(() => {
          const el = sideRef.current?.querySelector(`[data-lemma="${CSS.escape(key)}"]`)
          if (el) el.scrollIntoView({ block: 'center', behavior: 'smooth' })
          else flash(`「${word}」不在本篇词表，可点「全部生词」查看`)
        }),
      )
    },
    [setFocusLemma, sideRef, flash],
  )

  /** 滚到某一句（优先滚可见的那个—「只看译文」时英文是隐藏的）。 */
  const scrollToSid = useCallback(
    (sid: string) => {
      visibleSidNode(articleRef.current, sid)?.scrollIntoView({ block: 'center', behavior: 'smooth' })
    },
    [articleRef],
  )

  /** 点生词本词条 → 回原文定位（优先用来源句，没有就在当前正文里搜；找到后回填来源）。 */
  const jumpToSource = useCallback(
    (item: VocabItem) => {
      if (!doc) return
      let sid =
        item.source?.fileName === articleIdentity && item.source.sentenceId ? item.source.sentenceId : null
      if (sid && !doc.sentences.some((s) => s.id === sid)) sid = null
      let hit = sid ? doc.sentences.find((s) => s.id === sid) : undefined
      if (!hit) {
        hit = doc.sentences.find((s) =>
          wordSpans(s.text).some(
            (w) => w.text.toLowerCase() === item.word.toLowerCase() || lemmaOf(w.text) === item.lemma,
          ),
        )
        sid = hit?.id ?? null
      }
      if (!hit || !sid) {
        flash('当前这篇里找不到这个词')
        return
      }
      // 回填来源，下次直接跳、也让 A/D 与来源更准
      if (!item.source || item.source.sentenceId !== sid) {
        persist({
          ...library,
          items: library.items.map((it) =>
            it.id === item.id
              ? {
                  ...it,
                  source: {
                    articleId: articleTitle || articleKey || '手动粘贴',
                    fileName: articleKey,
                    sentenceId: sid,
                    sentenceText: hit!.text,
                  },
                }
              : it,
          ),
        })
      }
      setPeekSid(sid)
      window.requestAnimationFrame(() => scrollToSid(sid))
    },
    [doc, articleIdentity, articleTitle, articleKey, library, persist, flash, scrollToSid, setPeekSid],
  )

  /** A/D：在所有句子间上/下移动，临时浮动高亮作为提示并滚到中间（选词模式游标）。 */
  const navigateVocab = useCallback(
    (dir: 1 | -1) => {
      if (!doc || !doc.sentences.length) return
      const sids = doc.sentences.map((s) => s.id)
      const cur = peekSid ?? selectedId
      let idx = cur ? sids.indexOf(cur) : -1
      idx = idx < 0 ? (dir === 1 ? 0 : sids.length - 1) : (idx + dir + sids.length) % sids.length
      const sid = sids[idx]
      setPeekSid(sid)
      window.requestAnimationFrame(() => scrollToSid(sid))
    },
    [doc, peekSid, selectedId, scrollToSid, setPeekSid],
  )
  navVocabRef.current = navigateVocab

  return { focusEntry, scrollToSid, jumpToSource, navigateVocab }
}
