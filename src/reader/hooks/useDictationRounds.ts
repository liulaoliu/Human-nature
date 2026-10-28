import { useCallback, type Dispatch, type MutableRefObject, type SetStateAction } from 'react'
import { packSegments, pickBlankTargets, splitForDictationSpans, takeRound } from '../../core/dictation'
import { wordSpans } from '../../core/wordSelect'
import { articleKey } from '../../core/docSignature'
import type { Sentence } from '../../types/document'
import type { DictItemData, DictSessionSnapshot } from '../../core/sessionSnapshots'

const cursorKey = (articleKeyOf: string, mode: 'full' | 'cloze') => `reader:dictCursor:${mode}:${articleKeyOf}`
function readCursor(k: string): number {
  try {
    const v = localStorage.getItem(k)
    return v ? parseInt(v, 10) || 0 : 0
  } catch {
    return 0
  }
}
function writeCursor(k: string, v: number): void {
  try {
    localStorage.setItem(k, String(v))
  } catch {
    /* 隐私模式等忽略 */
  }
}

export interface UseDictationRoundsParams {
  doc: { sentences: Sentence[] } | null
  articleIdentity: string
  libraryLemmas: Set<string>
  mode: 'full' | 'cloze'
  words: number
  blankCount: number
  clozeWords: number
  maxQuestions: number
  setMode: (mode: 'full' | 'cloze') => void
  setWords: (v: number) => void
  setBlankCount: (v: number) => void
  setClozeWords: (v: number) => void
  setMaxQuestions: (v: number) => void
  setQueue: Dispatch<SetStateAction<DictItemData[] | null>>
  setRoundInfo: Dispatch<SetStateAction<{ offset: number; grand: number }>>
  setIndex: Dispatch<SetStateAction<number>>
  setInput: Dispatch<SetStateAction<string>>
  setChecked: Dispatch<SetStateAction<boolean>>
  setDiff: Dispatch<SetStateAction<DictSessionSnapshot['diff']>>
  setBlanks: Dispatch<SetStateAction<string[]>>
  setResults: Dispatch<SetStateAction<boolean[]>>
  setWrongItems: Dispatch<SetStateAction<DictItemData[]>>
  wrongItems: DictItemData[]
  recordedRef: MutableRefObject<boolean>
  flash: (message: string) => void
  clearAdvance: () => void
  closeOthers: () => void
}

/** 听写的一轮：装题（开篇 / 片段 / 重练错题）与队列推进。 */
export function useDictationRounds({
  doc,
  articleIdentity,
  libraryLemmas,
  mode,
  words,
  blankCount,
  clozeWords,
  maxQuestions,
  setMode,
  setWords,
  setBlankCount,
  setClozeWords,
  setMaxQuestions,
  setQueue,
  setRoundInfo,
  setIndex,
  setInput,
  setChecked,
  setDiff,
  setBlanks,
  setResults,
  setWrongItems,
  wrongItems,
  recordedRef,
  flash,
  clearAdvance,
  closeOthers,
}: UseDictationRoundsParams) {
  const next = useCallback(() => {
    clearAdvance()
    setInput('')
    setChecked(false)
    setDiff(null)
    setBlanks([])
    setIndex((i) => i + 1)
  }, [clearAdvance, setInput, setChecked, setDiff, setBlanks, setIndex])

  /** 装一轮题：开篇 / 指定片段 / 重练错题共用同一套重置，别各写一份。 */
  const beginRound = useCallback(
    (items: DictItemData[], info: { offset: number; grand: number }) => {
      setQueue(items)
      setRoundInfo(info)
      setIndex(0)
      setInput('')
      setChecked(false)
      setDiff(null)
      setBlanks([])
      setResults([])
      setWrongItems([])
      recordedRef.current = false
    },
    [
      setQueue,
      setRoundInfo,
      setIndex,
      setInput,
      setChecked,
      setDiff,
      setBlanks,
      setResults,
      setWrongItems,
      recordedRef,
    ],
  )

  const start = useCallback(
    (opts?: { mode?: 'full' | 'cloze'; words?: number; blanks?: number; clozeWords?: number; max?: number }) => {
      clearAdvance()
      if (!doc) {
        flash('先打开一篇文章')
        return
      }
      const nextMode = opts?.mode ?? mode
      const maxWords = opts?.words ?? words
      const wantBlanks = opts?.blanks ?? blankCount
      const segWords = opts?.clozeWords ?? clozeWords
      const maxQ = opts?.max ?? maxQuestions
      if (opts?.words != null) setWords(opts.words)
      if (opts?.blanks != null) setBlankCount(opts.blanks)
      if (opts?.clozeWords != null) setClozeWords(opts.clozeWords)
      if (opts?.max != null) setMaxQuestions(opts.max)

      const items: DictItemData[] = []
      if (nextMode === 'cloze') {
        // 填空：按「每段最多 segWords 词」并句成段（段越长题越少）；目标词固定下来
        packSegments(
          doc.sentences.map((s) => s.text),
          segWords,
        ).forEach((text, si) => {
          const targets = pickBlankTargets(text, libraryLemmas, wantBlanks)
          if (targets.length > 0) items.push({ id: `seg-${si}`, text, targets })
        })
      } else {
        doc.sentences.forEach((s) => {
          const spans = splitForDictationSpans(s.text, maxWords)
          const words = wordSpans(s.text)
          spans.forEach((sp, ci) => {
            const t = sp.text.trim()
            if (!t) return
            const item: DictItemData = { id: `${s.id}-${ci}`, text: t }
            // 字符区间 → 词下标区间：播放时复用整句音频并 seek（不新合成）
            const sw = words.findIndex((w) => w.end > sp.start)
            let ew = -1
            for (let i = words.length - 1; i >= 0; i--) {
              if (words[i].start < sp.end) {
                ew = i
                break
              }
            }
            if (sw >= 0 && ew >= sw) {
              item.src = s.text
              item.sw = sw
              item.ew = ew
            }
            items.push(item)
          })
        })
      }

      if (!items.length) {
        flash(nextMode === 'cloze' ? '这篇没有可用于填空的句子' : '这篇没有可听写的句子')
        return
      }
      // 每轮限题：从断点取一段，做完下次接着来（走到末尾自动回到开头）
      const key = cursorKey(articleKey(articleIdentity ?? '', doc?.sentences ?? []), nextMode)
      const { items: round, next: nextCursor, offset } = takeRound(items, readCursor(key), maxQ)
      writeCursor(key, nextCursor)
      setMode(nextMode)
      closeOthers()
      beginRound(round, { offset, grand: items.length })
    },
    [
      doc,
      articleIdentity,
      mode,
      words,
      blankCount,
      clozeWords,
      maxQuestions,
      libraryLemmas,
      flash,
      clearAdvance,
      closeOthers,
      setMode,
      setWords,
      setBlankCount,
      setClozeWords,
      setMaxQuestions,
      beginRound,
    ],
  )

  /** 用指定片段开一轮听写（错题本「重练听写」用）。 */
  const startItems = useCallback(
    (items: { id: string; text: string }[]) => {
      if (!items.length) return
      clearAdvance()
      setMode('full')
      closeOthers()
      beginRound(items, { offset: 0, grand: items.length })
    },
    [clearAdvance, closeOthers, setMode, beginRound],
  )

  /** 听写「重练错题」：只重练本轮错的那些段。 */
  const retryWrong = useCallback(() => {
    if (!wrongItems.length) return
    clearAdvance()
    beginRound(wrongItems, { offset: 0, grand: wrongItems.length })
  }, [wrongItems, clearAdvance, beginRound])

  const close = useCallback(() => {
    clearAdvance()
    setQueue(null)
  }, [clearAdvance, setQueue])

  return { next, start, startItems, retryWrong, close }
}
