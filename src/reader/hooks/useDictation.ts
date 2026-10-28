import { useCallback, useEffect, useMemo, useRef } from 'react'
import {
  diffWords,
  dictationWrongWords,
  isClozeBlankCorrect,
  makeCloze,
  packSegments,
  pickBlankTargets,
  splitForDictationSpans,
  takeRound,
} from '../../core/dictation'
import { wordSpans } from '../../core/wordSelect'
import type { Sentence } from '../../types/document'
import type { ActivityCat } from '../../core/activity'
import type { AnswerEventInput } from '../../core/answerEvents'
import type { PracticeKind } from '../../core/practice'
import type { MistakeEntry } from '../../core/mistakes'
import { dictMistake } from '../../core/mistakes'
import { useLocalStorageState, persistentEnum, persistentNumber } from './useLocalStorageState'
import { useHotkeys } from '../useHotkeys'
import type { DictItemData } from '../../core/sessionSnapshots'
import { articleKey } from '../../core/docSignature'
import { useDelayedAction } from './useDelayedAction'
import { useDictationSnapshot } from './useDictationSnapshot'

/** 待选项的最小形状（与 reader 的 BatchItem 结构一致）。 */
type BatchItemLike = { word: string; sentence: string; sentenceId: string | null }

/** 听写预热窗口：当前题往后预合成几题；太大时「不限题数」会让整篇排队。 */
const DICT_WARM_AHEAD = 6

const cursorKey = (articleKeyOf: string, mode: 'full' | 'cloze') =>
  `reader:dictCursor:${mode}:${articleKeyOf}`
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

/** 听写面板的一题：句子 id + 原文；填空题额外带上「固定挖哪些空」。 */
export type DictItem = DictItemData

export interface UseDictationParams {
  doc: { sentences: Sentence[] } | null
  /** 当前文章标识（答题事件归属用；没开文章时为空串）。 */
  articleIdentity?: string
  libraryLemmas: Set<string>
  speak: (text: string) => void
  /** 预热若干文本的音频（后台合成、不下载正文）；填空并段用它缓存，避免每次重新合成。 */
  warmTexts: (texts: string[]) => void
  /** 预热「整句音频 + 逐词时间戳」；整句模式复用它来 seek 播放（零额外合成）。 */
  warmTimings: (texts: string[]) => void
  flash: (message: string) => void
  mergeBatch: (items: BatchItemLike[]) => void
  batchItemsFromWords: (words: string[]) => BatchItemLike[]
  recordActivity: (cat: ActivityCat, n?: number) => void
  recordPractice: (kind: PracticeKind, total: number, correct: number) => void
  /** 每题追加一条答题事件（可选；旧调用方不传就只写聚合值）。 */
  recordAnswer?: (event: AnswerEventInput) => void
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
    articleIdentity = '',
    libraryLemmas,
    speak,
    warmTexts,
    warmTimings,
    flash,
    mergeBatch,
    batchItemsFromWords,
    recordActivity,
    recordPractice,
    recordAnswer,
    addMistake,
    dropMistake,
    closeOthers,
  } = params

  // ---- 偏好设置（持久化） ----
  const [mode, setMode] = useLocalStorageState<'full' | 'cloze'>(
    'reader:dictMode',
    'full',
    persistentEnum(['full', 'cloze'] as const, 'full'),
  )
  /** 整句模式每句最多多少词。 */
  const [words, setWords] = useLocalStorageState('reader:dictWords', 12, persistentNumber)
  /** 填空模式每题挖几个空。 */
  const [blankCount, setBlankCount] = useLocalStorageState('reader:dictBlankCount', 2, persistentNumber)
  /** 填空模式每个题最多多少词（越大并得越长、题越少）。 */
  const [clozeWords, setClozeWords] = useLocalStorageState('reader:dictClozeWords', 40, persistentNumber)
  /** 每轮最多做多少题（0=不限）；做不完下次从断点继续。 */
  const [maxQuestions, setMaxQuestions] = useLocalStorageState('reader:dictMaxQuestions', 20, persistentNumber)

  // ---- 会话（落盘/恢复在 useDictationSnapshot） ----
  const {
    restored,
    queue,
    setQueue,
    index,
    setIndex,
    input,
    setInput,
    checked,
    setChecked,
    diff,
    setDiff,
    blanks,
    setBlanks,
    results,
    setResults,
    wrongItems,
    setWrongItems,
    roundInfo,
    setRoundInfo,
  } = useDictationSnapshot({ mode, setMode })
  // 恢复的会话若已做完，别在挂载时把成绩再记一遍
  const recordedRef = useRef(!!restored && restored.index >= restored.queue.length)
  const { clear: clearAdvance, schedule } = useDelayedAction()

  const next = useCallback(() => {
    clearAdvance()
    setInput('')
    setChecked(false)
    setDiff(null)
    setBlanks([])
    setIndex((i) => i + 1)
  }, [clearAdvance])

  /** 装一轮题：开篇 / 指定片段 / 重练错题共用同一套重置，别各写一份。 */
  const beginRound = useCallback((items: DictItem[], info: { offset: number; grand: number }) => {
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
  }, [])

  /** 当前短块的挖空题（每块稳定，不随重渲染乱跳）。 */
  const cloze = useMemo(() => {
    if (mode !== 'cloze' || !queue || index >= queue.length) return null
    const item = queue[index]
    // 优先用开轮时固定下来的目标词（刷新恢复后仍对得上）；兜底才现挑
    const targets = item.targets ?? pickBlankTargets(item.text, libraryLemmas, blankCount)
    return makeCloze(item.text, targets)
  }, [mode, queue, index, libraryLemmas, blankCount])

  // 预热「当前题及后几题」：
  //  - 整句模式：块复用整句音频 + seek，只需备好「源句」的音频/时间戳（零额外合成）；
  //  - 填空模式：块是跨句并段、没有现成音频，只能预热块本身。
  // 只开有限窗口并随进度前移，避免「不限题数」时一次把整篇几百块全排队。
  useEffect(() => {
    if (!queue || index >= queue.length) return
    const win = queue.slice(index, index + 1 + DICT_WARM_AHEAD)
    if (mode === 'full') {
      const srcs = [...new Set(win.map((i) => i.src).filter((x): x is string => !!x))]
      if (srcs.length) warmTimings(srcs)
    } else {
      warmTexts(win.map((i) => i.text))
    }
  }, [queue, index, mode, warmTexts, warmTimings])

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

      const items: DictItem[] = []
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
            const item: DictItem = { id: `${s.id}-${ci}`, text: t }
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
    recordAnswer?.({
      articleId: articleIdentity,
      source: 'dictation',
      kind: 'dictation',
      cat: 'listen',
      correct: ok,
      questionId: item.id,
    })
    setResults((r) => [...r, ok])
    if (!ok) {
      setWrongItems((w) => (w.some((x) => x.id === item.id) ? w : [...w, { id: item.id, text: item.text }]))
    }
    // 错题本：听写漏词（对→清掉，错→记上）
    const dictId = dictMistake(item.text, '').id
    if (ok) dropMistake(dictId)
    else addMistake(dictMistake(item.text, new Date().toISOString()))
    // 全对 → 自动下一句；有错 → 停下（显示原文，等手动下一句）
    if (ok) schedule(700, next)
  }, [queue, index, input, mode, blanks, cloze, recordActivity, recordAnswer, articleIdentity, next, schedule, addMistake, dropMistake])

  /** 听写「重练错题」：只重练本轮错的那些段。 */
  const retryWrong = useCallback(() => {
    if (!wrongItems.length) return
    clearAdvance()
    beginRound(wrongItems, { offset: 0, grand: wrongItems.length })
  }, [wrongItems, clearAdvance, beginRound])

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

  // 快捷键：回车 检查 / 下一句，Tab 重听，Esc 退出
  useHotkeys(
    (e) => {
      if (!queue) return
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
    },
    !!queue,
    50,
  )

  return {
    mode,
    words,
    blankCount,
    clozeWords,
    maxQuestions,
    roundInfo,
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
