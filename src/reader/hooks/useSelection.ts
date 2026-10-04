import { useCallback, useEffect, useRef, type MouseEvent, type MutableRefObject, type RefObject } from 'react'
import { snapSelection, wordSpans } from '../../core/wordSelect'
import { lemmaOf, markWord } from '../../core/vocab'
import type { Sentence, VocabItem, VocabLibrary } from '../../types/document'

type BatchItemLike = { word: string; sentence: string; sentenceId: string | null }

/** 顺着节点往上找它所在的句子 span（用 class="sent" 认）。 */
function sentSpanOf(node: Node | null): HTMLElement | null {
  let el: Node | null = node instanceof Element ? node : node?.parentNode ?? null
  while (el && !(el instanceof HTMLElement && el.classList.contains('sent'))) el = el.parentNode
  return el instanceof HTMLElement ? el : null
}

/** container/offset 相对 root 起点、按字符算的偏移量。 */
function offsetIn(root: HTMLElement, container: Node, offset: number): number | null {
  if (!root.contains(container)) return null
  const r = document.createRange()
  r.selectNodeContents(root)
  r.setEnd(container, offset)
  return r.toString().length
}

export interface UseSelectionParams {
  selectedId: string | null
  setSelectedId: (v: string | null) => void
  exact: string
  setExact: (v: string) => void
  setUseExact: (v: boolean) => void
  selSid: string | null
  setSelSid: (v: string | null) => void
  selIndices: number[]
  setSelIndices: (v: number[]) => void
  ctrlHeld: boolean
  altHeld: boolean
  peekSid: string | null
  setPeekSid: (v: string | null) => void
  lastPicked: { word: string; sid: string } | null
  setLastPicked: (v: { word: string; sid: string } | null) => void
  setBubblePos: (v: { top: number; left: number } | null) => void
  batch: BatchItemLike[]
  addToBatch: (words: string[], sentence: string, sentenceId: string | null) => void
  sentence: Sentence | null
  vocabMode: boolean
  editing: boolean
  doc: { sentences: Sentence[] } | null
  library: VocabLibrary
  persist: (library: VocabLibrary) => void
  articleIdentity: string
  articleTitle: string
  articleKey: string | null
  setFocusLemma: (v: string | null) => void
  articleRef: RefObject<HTMLElement | null>
  sideRef: RefObject<HTMLElement | null>
  applyingDom: MutableRefObject<boolean>
  rightDownRef: MutableRefObject<boolean>
  sessionPickedRef: MutableRefObject<number>
  navVocabRef: MutableRefObject<(dir: 1 | -1) => void>
  stopReadAll: () => void
  resetSpoken: () => void
  fontSize: string
  bold: boolean
  serif: boolean
  flash: (message: string) => void
}

/**
 * 选区与划词：读取原生选区（整句 / 整词吸附 / Ctrl 离散多选 / 选词模式），
 * 点句选中 / 停止朗读、点生词高亮跳转、A/D 跳句、气泡定位、右键加入待选、直接入库。
 */
export function useSelection({
  selectedId,
  setSelectedId,
  exact,
  setExact,
  setUseExact,
  selSid,
  setSelSid,
  selIndices,
  setSelIndices,
  ctrlHeld,
  altHeld,
  peekSid,
  setPeekSid,
  lastPicked,
  setLastPicked,
  setBubblePos,
  batch,
  addToBatch,
  sentence,
  vocabMode,
  editing,
  doc,
  library,
  persist,
  articleIdentity,
  articleTitle,
  articleKey,
  setFocusLemma,
  articleRef,
  sideRef,
  applyingDom,
  rightDownRef,
  sessionPickedRef,
  navVocabRef,
  stopReadAll,
  resetSpoken,
  fontSize,
  bold,
  serif,
  flash,
}: UseSelectionParams) {
  /** 点句子：切换选中；再点同一句 = 停止朗读（点新句子也先停掉「朗读全文」）。 */
  const selectedIdRef = useRef(selectedId)
  selectedIdRef.current = selectedId
  const selectSentence = useCallback(
    (sid: string) => {
      const same = selectedIdRef.current === sid
      stopReadAll()
      resetSpoken()
      if (!same) setSelectedId(sid)
    },
    [stopReadAll, resetSpoken, setSelectedId],
  )

  /** 点正文里的生词 → 高亮并滚到生词本对应词条。 */
  const focusEntry = useCallback(
    (word: string) => {
      const key = lemmaOf(word)
      setFocusLemma(key)
      window.requestAnimationFrame(() => {
        sideRef.current
          ?.querySelector(`[data-lemma="${CSS.escape(key)}"]`)
          ?.scrollIntoView({ block: 'center', behavior: 'smooth' })
      })
    },
    [setFocusLemma, sideRef],
  )

  /** 滚到某一句（优先滚可见的那个—「只看译文」时英文是隐藏的）。 */
  const scrollToSid = useCallback(
    (sid: string) => {
      const nodes = articleRef.current?.querySelectorAll(`[data-sid="${CSS.escape(sid)}"]`)
      const el = nodes ? ([...nodes] as HTMLElement[]).find((e) => e.offsetParent !== null) : undefined
      el?.scrollIntoView({ block: 'center', behavior: 'smooth' })
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

  // 最近选中的词 → 气泡位置（贴在所在句上方）
  useEffect(() => {
    if (!lastPicked) {
      setBubblePos(null)
      return
    }
    const nodes = articleRef.current?.querySelectorAll(`[data-sid="${CSS.escape(lastPicked.sid)}"]`)
    const el = nodes ? ([...nodes] as HTMLElement[]).find((e) => e.offsetParent !== null) : undefined
    if (!el) {
      setBubblePos(null)
      return
    }
    setBubblePos({ top: el.offsetTop - 4, left: el.offsetLeft })
  }, [lastPicked, doc, fontSize, bold, serif, articleRef, setBubblePos])

  /** 让原生选区消失（改用我们的圆角 .hl 高亮）。 */
  const clearDomSelection = useCallback(() => {
    const sel = window.getSelection()
    if (!sel) return
    applyingDom.current = true
    sel.removeAllRanges()
    window.requestAnimationFrame(() => {
      applyingDom.current = false
    })
  }, [applyingDom])

  /** 字符区间 [start,end) 覆盖了这句话的第几到第几个词。 */
  const wordIndexRange = useCallback((text: string, start: number, end: number) => {
    const spans = wordSpans(text)
    const first = spans.findIndex((w) => w.end > start)
    if (first < 0) return null
    let last = first
    for (let i = spans.length - 1; i >= 0; i--) {
      if (spans[i].start < end) {
        last = i
        break
      }
    }
    return { start: first, end: last + 1 }
  }, [])

  /**
   * 读取当前选区。
   *   - Ctrl：只选**一个词**
   *   - 不按 Ctrl + 单击：**整句**
   *   - 不按 Ctrl + 拖动：按**整词吸附**
   * finalize=true（松手）时清掉原生选区，改用能加圆角的 .hl。
   */
  const applySelection = useCallback(
    (ctrl: boolean, finalize: boolean) => {
      const sel = window.getSelection()
      if (!sel || sel.rangeCount === 0) return
      const range = sel.getRangeAt(0)
      const span = sentSpanOf(range.startContainer) ?? sentSpanOf(range.endContainer)
      if (!span) return
      const sid = span.dataset.sid ?? null
      if (sid) setSelectedId(sid)
      setPeekSid(null)

      const text = span.textContent ?? ''
      const a = offsetIn(span, range.startContainer, range.startOffset)
      const b = offsetIn(span, range.endContainer, range.endOffset)
      if (a == null || b == null) return
      const sentenceText = text.trim()
      const spans = wordSpans(text)

      /** 设精确选区（离散词下标）；vocabMode 加进待选时清空精确选区（避免两处重复）。 */
      const commitSel = (indices: number[], batchWord?: string) => {
        const uniq = [...new Set(indices)].sort((x, y) => x - y)
        if (finalize && vocabMode && sid && batchWord) {
          setSelSid(null)
          setSelIndices([])
          setExact('')
          setUseExact(false)
          const already = batch.some((x) => lemmaOf(x.word) === lemmaOf(batchWord))
          addToBatch([batchWord], sentenceText, sid)
          if (!already) sessionPickedRef.current += 1
          setLastPicked({ word: batchWord, sid })
        } else {
          setSelSid(sid)
          setSelIndices(uniq)
          setExact(uniq.map((i) => spans[i].text).join(' '))
          setUseExact(uniq.length > 0)
        }
        if (finalize) clearDomSelection()
      }

      const indicesInRange = (startChar: number, endChar: number): number[] => {
        const r = wordIndexRange(text, startChar, endChar)
        const out: number[] = []
        if (r) for (let i = r.start; i < r.end; i++) out.push(i)
        return out
      }

      const idxAt = (offset: number) => spans.findIndex((w) => offset >= w.start && offset < w.end)

      // 选词模式：普通点=该词进待选；Ctrl 点=离散选区，拼成词组后再点「加入待选」；Alt/Ctrl 拖动=整段
      if (vocabMode) {
        if (range.collapsed) {
          const idx = idxAt(a)
          if (idx < 0) return
          if (ctrl) {
            if (!finalize) return
            const cur = new Set(selSid === sid ? selIndices : [])
            if (cur.has(idx)) cur.delete(idx)
            else cur.add(idx)
            commitSel([...cur])
            return
          }
          commitSel([idx], spans[idx].text)
          return
        }
        const end = altHeld || ctrl ? b : a
        const snapped = snapSelection(text, a, end)
        if (!snapped) return
        commitSel(indicesInRange(snapped.start, snapped.end), snapped.text)
        return
      }

      // 非选词：Ctrl 点 = **离散多选**（点 bar、from 就选这两个，不补中间）
      if (ctrl && range.collapsed) {
        if (!finalize) return
        const idx = idxAt(a)
        if (idx < 0) return
        const cur = new Set(selSid === sid ? selIndices : [])
        if (cur.has(idx)) cur.delete(idx)
        else cur.add(idx)
        commitSel([...cur])
        return
      }

      if (range.collapsed) {
        // 只是点了一下：整句
        setExact('')
        setUseExact(false)
        setSelSid(null)
        setSelIndices([])
        return
      }

      // 拖动：连续整段（Ctrl / 非 Ctrl 一样）
      const snapped = snapSelection(text, a, b)
      if (!snapped) return
      commitSel(indicesInRange(snapped.start, snapped.end))
    },
    [
      vocabMode,
      altHeld,
      batch,
      addToBatch,
      clearDomSelection,
      wordIndexRange,
      selSid,
      selIndices,
      setSelectedId,
      setPeekSid,
      setSelSid,
      setSelIndices,
      setExact,
      setUseExact,
      setLastPicked,
      sessionPickedRef,
    ],
  )

  // 拖动过程中实时更新（不改 DOM，避免和拖选打架）；松手时才清原生选区、显示圆角高亮
  useEffect(() => {
    if (editing) return
    const handler = () => {
      if (applyingDom.current) return
      if (rightDownRef.current) return
      const sel = window.getSelection()
      if (!sel || sel.rangeCount === 0) return
      applySelection(ctrlHeld, false)
    }
    document.addEventListener('selectionchange', handler)
    return () => document.removeEventListener('selectionchange', handler)
  }, [editing, ctrlHeld, applySelection, applyingDom, rightDownRef])

  const onMouseUp = useCallback(
    (e: MouseEvent<HTMLElement>) => {
      if (editing) return
      if (e.button !== 0) {
        rightDownRef.current = false
        return // 右键单独处理
      }
      applySelection(e.ctrlKey || e.metaKey, true)
    },
    [editing, applySelection, rightDownRef],
  )

  const onMouseDown = useCallback(
    (e: MouseEvent<HTMLElement>) => {
      rightDownRef.current = e.button === 2
    },
    [rightDownRef],
  )

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

  // 选词模式下有精确选区时，右键 = 「加入待选」（不再弹浏览器菜单）
  const onContextMenu = useCallback(
    (e: MouseEvent<HTMLElement>) => {
      rightDownRef.current = false
      if (!vocabMode || !exact.trim()) return
      e.preventDefault()
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
    })
    persist(result.library)
    flash(result.created ? `已加入：${result.item.word}` : `已合并：${result.item.word}`)
  }, [exact, library, articleIdentity, articleTitle, articleKey, sentence, persist, flash])

  return {
    selectSentence,
    focusEntry,
    scrollToSid,
    jumpToSource,
    navigateVocab,
    clearDomSelection,
    applySelection,
    onMouseUp,
    onMouseDown,
    addSelectionToBatch,
    onContextMenu,
    mark,
  }
}
