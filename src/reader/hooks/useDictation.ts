import { useEffect, useMemo, useRef } from 'react'
import {
  makeCloze,
  pickBlankTargets,
} from '../../core/dictation'
import type { Sentence } from '../../types/document'
import type { ActivityCat } from '../../core/activity'
import type { AnswerEventInput } from '../../core/answerEvents'
import type { PracticeKind } from '../../core/practice'
import type { MistakeEntry } from '../../core/mistakes'
import { useHotkeys } from '../useHotkeys'
import type { DictItemData } from '../../core/sessionSnapshots'
import type { BatchItemLike } from '../batchItem'
import { useDelayedAction } from './useDelayedAction'
import { useDictationChecking } from './useDictationChecking'
import { useDictationPrefs } from './useDictationPrefs'
import { useDictationRounds } from './useDictationRounds'
import { useDictationSnapshot } from './useDictationSnapshot'

/** 听写预热窗口：当前题往后预合成几题；太大时「不限题数」会让整篇排队。 */
const DICT_WARM_AHEAD = 6

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
 * 偏好、装题/游标、判分分别住在 useDictationPrefs / useDictationRounds / 本 hook。
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

  const prefs = useDictationPrefs()
  const { mode, setMode, words, blankCount, clozeWords, maxQuestions } = prefs

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

  const rounds = useDictationRounds({
    doc,
    articleIdentity,
    libraryLemmas,
    mode,
    words,
    blankCount,
    clozeWords,
    maxQuestions,
    setMode,
    setWords: prefs.setWords,
    setBlankCount: prefs.setBlankCount,
    setClozeWords: prefs.setClozeWords,
    setMaxQuestions: prefs.setMaxQuestions,
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
  })
  const { next, start, startItems, retryWrong, close } = rounds

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

  const { check, wrongNow, setBlank } = useDictationChecking({
    queue,
    index,
    mode,
    cloze,
    blanks,
    input,
    articleIdentity,
    recordActivity,
    recordAnswer,
    addMistake,
    dropMistake,
    schedule,
    next,
    mergeBatch,
    batchItemsFromWords,
    flash,
    setDiff,
    setChecked,
    setResults,
    setWrongItems,
    setBlanks,
  })

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
  }, [queue, index, results, recordPractice, recordedRef])

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
    ...prefs,
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
