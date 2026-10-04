import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  diffWords,
  dictationWrongWords,
  isClozeBlankCorrect,
  makeCloze,
  pickBlankTargets,
  splitForDictation,
  type DiffToken,
} from '../../core/dictation'
import type { Sentence } from '../../types/document'
import type { ActivityCat } from '../../core/activity'
import type { PracticeKind } from '../../core/practice'
import type { MistakeEntry } from '../../core/mistakes'
import { dictMistake } from '../../core/mistakes'
import { useLocalStorageState, persistentEnum, persistentNumber } from './useLocalStorageState'

/** 待选项的最小形状（与 reader 的 BatchItem 结构一致）。 */
type BatchItemLike = { word: string; sentence: string; sentenceId: string | null }

export interface UseDictationParams {
  doc: { sentences: Sentence[] } | null
  libraryLemmas: Set<string>
  speak: (text: string) => void
  flash: (message: string) => void
  mergeBatch: (items: BatchItemLike[]) => void
  batchItemsFromWords: (words: string[]) => BatchItemLike[]
  recordActivity: (cat: ActivityCat, n?: number) => void
  recordPractice: (kind: PracticeKind, total: number, correct: number) => void
  addMistake: (entry: MistakeEntry) => void
  dropMistake: (id: string) => void
  /** 开始听写时关掉其它会话（背单词/考试/快刷）。 */
  closeOthers: () => void
}

/**
 * 逐句听写 / 填空：队列、判分、自动下一句、错题重练、快捷键。
 *
 * 全对 → 自动下一句；有错 → 停下显示原文（等你手动下一句）。填不满空的长句会自动并句。
 */
export function useDictation(params: UseDictationParams) {
  const {
    doc,
    libraryLemmas,
    speak,
    flash,
    mergeBatch,
    batchItemsFromWords,
    recordActivity,
    recordPractice,
    addMistake,
    dropMistake,
    closeOthers,
  } = params

  const [queue, setQueue] = useState<{ id: string; text: string }[] | null>(null)
  const [index, setIndex] = useState(0)
  const [input, setInput] = useState('')
  const [checked, setChecked] = useState(false)
  const [diff, setDiff] = useState<DiffToken[] | null>(null)
  const [blanks, setBlanks] = useState<string[]>([])
  const [results, setResults] = useState<boolean[]>([])
  const [wrongItems, setWrongItems] = useState<{ id: string; text: string }[]>([])

  const [mode, setMode] = useLocalStorageState<'full' | 'cloze'>(
    'reader:dictMode',
    'full',
    persistentEnum(['full', 'cloze'] as const, 'full'),
  )
  /** 整句模式每句最多多少词。 */
  const [words, setWords] = useLocalStorageState('reader:dictWords', 12, persistentNumber)
  /** 填空模式每题挖几个空。 */
  const [blankCount, setBlankCount] = useLocalStorageState('reader:dictBlankCount', 2, persistentNumber)

  const advanceRef = useRef<number | null>(null)
  const recordedRef = useRef(false)

  const clearAdvance = useCallback(() => {
    if (advanceRef.current) {
      window.clearTimeout(advanceRef.current)
      advanceRef.current = null
    }
  }, [])

  const next = useCallback(() => {
    clearAdvance()
    setInput('')
    setChecked(false)
    setDiff(null)
    setBlanks([])
    setIndex((i) => i + 1)
  }, [clearAdvance])

  /** 当前短块的挖空题（每块稳定，不随重渲染乱跳）。 */
  const cloze = useMemo(() => {
    if (mode !== 'cloze' || !queue || index >= queue.length) return null
    const text = queue[index].text
    return makeCloze(text, pickBlankTargets(text, libraryLemmas, blankCount))
  }, [mode, queue, index, libraryLemmas, blankCount])

  const start = useCallback(
    (opts?: { mode?: 'full' | 'cloze'; words?: number; blanks?: number }) => {
      clearAdvance()
      if (!doc) {
        flash('先打开一篇文章')
        return
      }
      const nextMode = opts?.mode ?? mode
      const maxWords = opts?.words ?? words
      const wantBlanks = opts?.blanks ?? blankCount
      if (opts?.words != null) setWords(opts.words)
      if (opts?.blanks != null) setBlankCount(opts.blanks)

      const items: { id: string; text: string }[] = []
      if (nextMode === 'cloze') {
        // 填空：用整句；不够空就并下一句
        let i = 0
        const sents = doc.sentences
        while (i < sents.length) {
          let text = sents[i].text.trim()
          let j = i + 1
          while (
            j < sents.length &&
            pickBlankTargets(text, libraryLemmas, wantBlanks).length < wantBlanks &&
            j - i < 3 &&
            text.split(/\s+/).length < 60
          ) {
            text = `${text} ${sents[j].text.trim()}`.trim()
            j += 1
          }
          if (pickBlankTargets(text, libraryLemmas, wantBlanks).length > 0) {
            items.push({ id: `${sents[i].id}-c`, text })
          }
          i = j
        }
      } else {
        doc.sentences.forEach((s) => {
          splitForDictation(s.text, maxWords).forEach((chunk, ci) => {
            const t = chunk.trim()
            if (t) items.push({ id: `${s.id}-${ci}`, text: t })
          })
        })
      }

      if (!items.length) {
        flash(nextMode === 'cloze' ? '这篇没有可用于填空的句子' : '这篇没有可听写的句子')
        return
      }
      setMode(nextMode)
      closeOthers()
      setQueue(items)
      setIndex(0)
      setInput('')
      setChecked(false)
      setDiff(null)
      setBlanks([])
      setResults([])
      setWrongItems([])
      recordedRef.current = false
    },
    [doc, mode, words, blankCount, libraryLemmas, flash, clearAdvance, closeOthers, setMode, setWords, setBlankCount],
  )

  /** 用指定片段开一轮听写（错题本「重练听写」用）。 */
  const startItems = useCallback(
    (items: { id: string; text: string }[]) => {
      if (!items.length) return
      clearAdvance()
      setMode('full')
      closeOthers()
      setQueue(items)
      setIndex(0)
      setInput('')
      setChecked(false)
      setDiff(null)
      setBlanks([])
      setResults([])
      setWrongItems([])
      recordedRef.current = false
    },
    [clearAdvance, closeOthers, setMode],
  )

  const check = useCallback(() => {
    if (!queue) return
    const item = queue[index]
    if (!item) return
    let ok = false
    if (mode === 'cloze' && cloze) {
      ok = cloze.blanks.every((b, i) => isClozeBlankCorrect(b, blanks[i] ?? ''))
    } else {
      const d = diffWords(item.text, input)
      ok = d.correct
      setDiff(d.tokens)
    }
    setChecked(true)
    recordActivity('listen', 1)
    setResults((r) => [...r, ok])
    if (!ok) {
      setWrongItems((w) => (w.some((x) => x.id === item.id) ? w : [...w, { id: item.id, text: item.text }]))
    }
    // 错题本：听写漏词（对→清掉，错→记上）
    const dictId = dictMistake(item.text, '').id
    if (ok) dropMistake(dictId)
    else addMistake(dictMistake(item.text, new Date().toISOString()))
    // 全对 → 自动下一句；有错 → 停下（显示原文，等手动下一句）
    if (ok) {
      clearAdvance()
      advanceRef.current = window.setTimeout(() => {
        advanceRef.current = null
        next()
      }, 700)
    }
  }, [queue, index, input, mode, blanks, cloze, recordActivity, next, clearAdvance, addMistake, dropMistake])

  /** 听写「重练错题」：只重练本轮错的那些段。 */
  const retryWrong = useCallback(() => {
    if (!wrongItems.length) return
    clearAdvance()
    setQueue(wrongItems)
    setIndex(0)
    setInput('')
    setChecked(false)
    setDiff(null)
    setBlanks([])
    setResults([])
    setWrongItems([])
    recordedRef.current = false
  }, [wrongItems, clearAdvance])

  /** 把本句漏写 / 填错的词加入待选。 */
  const wrongNow = useCallback(() => {
    if (!queue) return
    const item = queue[index]
    if (!item) return
    let ws: string[] = []
    if (mode === 'cloze' && cloze) {
      ws = cloze.blanks.filter((b, i) => !isClozeBlankCorrect(b, blanks[i] ?? '')).map((b) => b.answer)
    } else {
      ws = dictationWrongWords(diffWords(item.text, input))
    }
    if (!ws.length) {
      flash('没有漏写 / 填错的词')
      return
    }
    mergeBatch(batchItemsFromWords(ws))
    flash(`已把 ${ws.length} 个词加入待选`)
  }, [queue, index, mode, cloze, blanks, input, mergeBatch, batchItemsFromWords, flash])

  const setBlank = useCallback((i: number, value: string) => {
    setBlanks((arr) => {
      const nextArr = [...arr]
      nextArr[i] = value
      return nextArr
    })
  }, [])

  const close = useCallback(() => {
    clearAdvance()
    setQueue(null)
  }, [clearAdvance])

  // 填空模式下万一遇到「没空可填」的题，自动跳过
  useEffect(() => {
    if (!queue || index >= queue.length) return
    if (mode === 'cloze' && (!cloze || cloze.blanks.length === 0)) next()
  }, [queue, index, mode, cloze, next])

  // 听写完成 → 记一次成绩
  useEffect(() => {
    if (!queue) return
    if (index >= queue.length && results.length > 0 && !recordedRef.current) {
      recordedRef.current = true
      recordPractice('dictation', results.length, results.filter(Boolean).length)
    }
  }, [queue, index, results, recordPractice])

  // 卸载时清掉「自动下一句」的定时器
  useEffect(() => {
    return () => {
      if (advanceRef.current) window.clearTimeout(advanceRef.current)
    }
  }, [])

  // 快捷键：回车 检查 / 下一句，Tab 重听，Esc 退出
  useEffect(() => {
    if (!queue) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        close()
        return
      }
      if (e.key === 'Tab') {
        const t = e.target as HTMLElement | null
        // 填空模式里有多个输入框，Tab 要用来切换输入框，别抢
        if (!t || (t.tagName !== 'INPUT' && t.tagName !== 'TEXTAREA')) {
          e.preventDefault()
          const s = queue[index]
          if (s) speak(s.text)
        }
        return
      }
      if (e.key !== 'Enter') return
      e.preventDefault()
      if (index >= queue.length) return
      if (!checked) check()
      else next()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [queue, index, checked, check, next, close, speak])

  return {
    mode,
    words,
    blankCount,
    queue,
    index,
    input,
    checked,
    diff,
    blanks,
    results,
    wrongItems,
    cloze,
    setInput,
    setBlank,
    start,
    startItems,
    check,
    next,
    retryWrong,
    wrongNow,
    close,
  }
}
