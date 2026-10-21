import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Sentence } from '../../types/document'
import { wordSpans, toggleIndex, wordsAtIndex } from '../../core/wordSelect'
import { readJson, writeJson } from '../storage'
import type { CollectedItem } from '../panels/SpeedReadBasket'
import { persistentBoolTrue, useLocalStorageState } from './useLocalStorageState'

const collectedKey = (docKey: string) => `reader:speedCollected:${docKey}`

function loadCollected(docKey: string): CollectedItem[] {
  const arr = readJson<unknown>(collectedKey(docKey), [])
  return Array.isArray(arr) ? arr.filter((x): x is CollectedItem => !!x && typeof x.word === 'string') : []
}

export interface UseSpeedReadWordsOptions {
  docKey: string
  /** 当前句（读完 / 空文章时为 undefined）。 */
  sentence: Sentence | undefined
  /** 换句时清空当前选择（传句序号即可）。 */
  selectionResetKey: number
  isKnown: (word: string) => boolean
  wordsInSentence: (sentenceId: string) => string[]
  onAddItems: (items: { word: string; sentenceId: string | null; sentenceText: string }[]) => void
  onRemoveWord: (word: string) => void
}

/**
 * 速读里的「选词 → 加入生词本 / 从本页清单移出」：选中的词、本页加入记录（持久化）、
 * 两步确认删除。只管数据与操作，不碰渲染；句子按词切分的 `spans` 也在这里算，面板与渲染共用一份。
 */
export function useSpeedReadWords({
  docKey,
  sentence,
  selectionResetKey,
  isKnown,
  wordsInSentence,
  onAddItems,
  onRemoveWord,
}: UseSpeedReadWordsOptions) {
  /** 输入框草稿 + 刚加入提示。 */
  const [wordDraft, setWordDraft] = useState('')
  const [addedWord, setAddedWord] = useState('')
  /** 本页加入生词本的记录（跨句汇总、持久化）。 */
  const [collected, setCollected] = useState<CollectedItem[]>(() => loadCollected(docKey))
  /** 右上角「本页加入」清单是否展开（可折叠，持久化）。 */
  const [collectedOpen, setCollectedOpen] = useLocalStorageState('reader:speedCollectedOpen', true, persistentBoolTrue)
  /** 是否显示「已加入生词本」的单词（关掉则列表显示为空）。 */
  const [showCollected, setShowCollected] = useLocalStorageState('reader:speedShowCollected', true, persistentBoolTrue)
  /** 删除的两步确认（点一次变红，3 秒内再点才真删）。 */
  const [confirmIdx, setConfirmIdx] = useState<number | null>(null)
  /** 本句当前选中的词——按**词下标**记录，同一个词的不同位置互不影响。 */
  const [selIdx, setSelIdx] = useState<number[]>([])
  /** 是否已把选中的词「合成本句词组」（合成后作为一整条加入）。 */
  const [merged, setMerged] = useState(false)
  /** 两步确认移出的词。 */
  const [confirmDel, setConfirmDel] = useState('')
  /** 当前句按词切分（复用正文同款 wordSpans）。 */
  const spans = useMemo(() => (sentence ? wordSpans(sentence.text) : []), [sentence])

  /** 当前清单属于哪篇文章；换篇那一轮跳过写入，避免把旧清单落到新键上。 */
  const loadedKeyRef = useRef(docKey)
  const skipWriteRef = useRef(false)

  // 换篇：重读新文章的清单。必须先于下面的写盘 effect，且跳过同一次提交的写入。
  useEffect(() => {
    if (loadedKeyRef.current === docKey) return
    loadedKeyRef.current = docKey
    skipWriteRef.current = true
    setCollected(loadCollected(docKey))
  }, [docKey])

  // 本页加入清单落盘（翻页 / 关掉重开都不丢）
  useEffect(() => {
    if (skipWriteRef.current) {
      skipWriteRef.current = false
      return
    }
    try {
      writeJson(collectedKey(docKey), collected)
    } catch {
      // 忽略
    }
  }, [collected, docKey])

  // 换句清空当前选择
  useEffect(() => {
    setSelIdx([])
    setMerged(false)
  }, [selectionResetKey])

  /** 当前选中的词形（按句内顺序；「合成词组」时并成一条）。 */
  const selWords = useMemo(() => {
    const picked = wordsAtIndex(spans, selIdx)
    return merged && picked.length > 1 ? [picked.join(' ')] : picked
  }, [merged, selIdx, spans])

  /** 清空当前选择（关掉选词模式时用）。 */
  const clearSelection = useCallback(() => {
    setSelIdx([])
    setMerged(false)
  }, [])

  const isSel = useCallback((i: number) => selIdx.includes(i), [selIdx])

  /** 点击词：切换**这一个位置**的选中（只选中，不入库）。 */
  const toggleSel = useCallback((i: number) => {
    setMerged(false)
    setSelIdx((prev) => toggleIndex(prev, i))
  }, [])

  /** 把一批词加入生词本，并记入本页清单。 */
  const commitAdd = useCallback(
    (items: CollectedItem[]) => {
      const list = items.filter((x) => x.word.trim())
      if (!list.length) return
      onAddItems(list.map((x) => ({ word: x.word.trim(), sentenceId: x.sentenceId, sentenceText: x.sentenceText })))
      setCollected((prev) => {
        const out = [...prev]
        for (const it of list) {
          if (!out.some((x) => x.word.toLowerCase() === it.word.toLowerCase() && x.sentenceId === it.sentenceId)) {
            out.push({ word: it.word.trim(), sentenceId: it.sentenceId, sentenceText: it.sentenceText })
          }
        }
        return out
      })
      const label = list.map((x) => x.word.trim()).join('、')
      setAddedWord(label)
      window.setTimeout(() => setAddedWord((cur) => (cur === label ? '' : cur)), 2000)
    },
    [onAddItems],
  )

  /** 「加入清单」：把本句选中的词（或合成后的词组）加入生词本。 */
  const addSelected = useCallback(() => {
    if (!sentence || !selWords.length) return
    commitAdd(selWords.map((w) => ({ word: w, sentenceId: sentence.id, sentenceText: sentence.text })))
    setSelIdx([])
    setMerged(false)
  }, [sentence, selWords, commitAdd])

  /** 输入框手打词/词组：直接加入。 */
  const addCustom = useCallback(
    (w: string) => {
      const t = w.trim()
      if (!t || !sentence) return
      commitAdd([{ word: t, sentenceId: sentence.id, sentenceText: sentence.text }])
      setWordDraft('')
    },
    [sentence, commitAdd],
  )

  /** 右键：把**这一个位置**的词加入生词本（等价于「加入清单」）。 */
  const addDirect = useCallback(
    (i: number) => {
      const word = spans[i]?.text
      if (!sentence || !word) return
      commitAdd([{ word, sentenceId: sentence.id, sentenceText: sentence.text }])
      setMerged(false)
      setSelIdx((prev) => prev.filter((x) => x !== i))
    },
    [sentence, spans, commitAdd],
  )

  /** 把本句选中的词按句内顺序合成一个词组（替换当前选择，待「加入清单」）。 */
  const mergePhrase = useCallback(() => {
    if (!sentence || merged || selIdx.length < 2) return
    if (wordsAtIndex(spans, selIdx).length < 2) return
    setMerged(true)
  }, [sentence, merged, selIdx, spans])

  /** 删除一条词：生词本与本页清单**一起改**（两个入口共用，避免只删了一边）。 */
  const deleteWord = useCallback(
    (word: string) => {
      const key = word.trim().toLowerCase()
      onRemoveWord(word)
      setCollected((prev) => prev.filter((x) => x.word.trim().toLowerCase() !== key))
    },
    [onRemoveWord],
  )

  /** 从本页清单删除一条（同时从生词本移除，用于剔除误加）。 */
  const removeCollected = useCallback(
    (i: number) => {
      const it = collected[i]
      if (!it) return
      deleteWord(it.word)
    },
    [collected, deleteWord],
  )

  /** 删除（两步确认）：第一次点变红，3 秒内再点才真删。 */
  const tapDelete = useCallback(
    (i: number) => {
      if (confirmIdx === i) {
        removeCollected(i)
        setConfirmIdx(null)
        return
      }
      setConfirmIdx(i)
      window.setTimeout(() => setConfirmIdx((cur) => (cur === i ? null : cur)), 3000)
    },
    [confirmIdx, removeCollected],
  )

  /** 本句已在生词本的词 / 短语（含从本句加入的多词词组），用于「移出」。 */
  const knownWords = useMemo(() => {
    const out: string[] = []
    const push = (w: string) => {
      const t = w.trim()
      if (t && !out.some((x) => x.toLowerCase() === t.toLowerCase())) out.push(t)
    }
    for (const w of spans) if (isKnown(w.text)) push(w.text)
    if (sentence) for (const w of wordsInSentence(sentence.id)) push(w)
    return out
  }, [spans, isKnown, wordsInSentence, sentence])

  /** 两步确认移出生词本（本页清单里的同名词一并清掉）。 */
  const tapRemove = useCallback(
    (word: string) => {
      if (confirmDel === word) {
        deleteWord(word)
        setConfirmDel('')
        return
      }
      setConfirmDel(word)
      window.setTimeout(() => setConfirmDel((cur) => (cur === word ? '' : cur)), 3000)
    },
    [confirmDel, deleteWord],
  )

  return {
    spans,
    wordDraft,
    setWordDraft,
    addedWord,
    collected,
    collectedOpen,
    setCollectedOpen,
    showCollected,
    setShowCollected,
    confirmIdx,
    confirmDel,
    selIdx,
    selWords,
    isSel,
    toggleSel,
    clearSelection,
    addSelected,
    addCustom,
    addDirect,
    mergePhrase,
    tapDelete,
    knownWords,
    tapRemove,
  }
}
