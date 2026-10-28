import { useCallback, useEffect, useRef, type MutableRefObject, type RefObject } from 'react'
import type { Sentence, VocabLibrary } from '../../types/document'
import type { BatchItemLike } from '../batchItem'
import { visibleSidNode } from './selectionDom'
import { useSelectionBatchActions } from './useSelectionBatchActions'
import { useSelectionDrag } from './useSelectionDrag'
import { useSelectionNavigate } from './useSelectionNavigate'

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
  fontSize: string
  bold: boolean
  serif: boolean
  flash: (message: string) => void
}

/**
 * 选区与划词：点句选中 / 停止朗读、点生词高亮跳转、A/D 跳句、气泡定位、右键加入待选、直接入库。
 *
 * 组合根；具体分成三块：
 *   - useSelectionNavigate：正文定位（生词 / 句子 / 回原文 / A-D）
 *   - useSelectionDrag：读原生选区并判成整句 / 整词 / 离散多选
 *   - useSelectionBatchActions：加待选、右键、直接入库
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
      if (!same) setSelectedId(sid)
    },
    [stopReadAll, setSelectedId],
  )

  const { focusEntry, scrollToSid, jumpToSource, navigateVocab } = useSelectionNavigate({
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
  })

  const { clearDomSelection, applySelection, onMouseUp, onMouseDown } = useSelectionDrag({
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
  })

  const { addSelectionToBatch, onContextMenu, mark } = useSelectionBatchActions({
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
  })

  // 最近选中的词 → 气泡位置（贴在所在句上方）
  useEffect(() => {
    if (!lastPicked) {
      setBubblePos(null)
      return
    }
    const el = visibleSidNode(articleRef.current, lastPicked.sid)
    if (!el) {
      setBubblePos(null)
      return
    }
    setBubblePos({ top: el.offsetTop - 4, left: el.offsetLeft })
  }, [lastPicked, doc, fontSize, bold, serif, articleRef, setBubblePos])

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
