import { useCallback, useEffect, type MouseEvent, type MutableRefObject } from 'react'
import { snapSelection, wordIndexRange, wordSpans } from '../../core/wordSelect'
import { lemmaOf } from '../../core/vocab'
import type { BatchItemLike } from '../batchItem'
import { offsetIn, sentSpanOf } from './selectionDom'

export interface UseSelectionDragParams {
  applyingDom: MutableRefObject<boolean>
  rightDownRef: MutableRefObject<boolean>
  sessionPickedRef: MutableRefObject<number>
  editing: boolean
  ctrlHeld: boolean
  altHeld: boolean
  vocabMode: boolean
  selSid: string | null
  selIndices: number[]
  batch: BatchItemLike[]
  addToBatch: (words: string[], sentence: string, sentenceId: string | null) => void
  setSelectedId: (v: string | null) => void
  setPeekSid: (v: string | null) => void
  setSelSid: (v: string | null) => void
  setSelIndices: (v: number[]) => void
  setExact: (v: string) => void
  setUseExact: (v: boolean) => void
  setLastPicked: (v: { word: string; sid: string } | null) => void
}

/**
 * 划词状态机：读取原生选区（整句 / 整词吸附 / Ctrl 离散多选 / 选词模式），
 * 拖动时实时更新，松手时清掉原生选区改用圆角高亮。
 *
 * 拖选与 selectionchange 必须共用同一个 `applySelection` 闭包，所以保持一个 hook；
 * 纯规则（整词吸附、字符区间 → 词下标）已经下沉到 `core/wordSelect.ts`。
 */
export function useSelectionDrag({
  applyingDom,
  rightDownRef,
  sessionPickedRef,
  editing,
  ctrlHeld,
  altHeld,
  vocabMode,
  selSid,
  selIndices,
  batch,
  addToBatch,
  setSelectedId,
  setPeekSid,
  setSelSid,
  setSelIndices,
  setExact,
  setUseExact,
  setLastPicked,
}: UseSelectionDragParams) {
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
      // 折叠的单击交给句子的 onClick（selectSentence）来选中：若这里也设 selectedId，
      // 随后 click 的 selectSentence 会误判成「又点了同一句」而停掉刚起的朗读（自动朗读时隐时现）。
      // 只有真正的选区（拖动 / Ctrl 多选）才在这里定句。
      if (sid && !range.collapsed) setSelectedId(sid)
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
      // Alt：保留浏览器原生选区，方便直接 Ctrl+C 复制（不被我们的划词逻辑清掉）
      if (altHeld && !vocabMode) return
      const sel = window.getSelection()
      if (!sel || sel.rangeCount === 0) return
      applySelection(ctrlHeld, false)
    }
    document.addEventListener('selectionchange', handler)
    return () => document.removeEventListener('selectionchange', handler)
  }, [editing, ctrlHeld, altHeld, vocabMode, applySelection, applyingDom, rightDownRef])

  const onMouseUp = useCallback(
    (e: MouseEvent<HTMLElement>) => {
      if (editing) return
      if (e.button !== 0) {
        rightDownRef.current = false
        return // 右键单独处理
      }
      // Alt：不清原生选区，让 ⌘/Ctrl+C 能复制（配合「按住 Alt 拖选」）
      if (e.altKey && !vocabMode) return
      applySelection(e.ctrlKey || e.metaKey, true)
    },
    [editing, applySelection, rightDownRef, vocabMode],
  )

  const onMouseDown = useCallback(
    (e: MouseEvent<HTMLElement>) => {
      rightDownRef.current = e.button === 2
    },
    [rightDownRef],
  )

  return { clearDomSelection, applySelection, onMouseUp, onMouseDown }
}
