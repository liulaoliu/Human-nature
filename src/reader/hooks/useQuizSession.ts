import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  buildQuizQuestions,
  countQuestions,
  isCorrect,
  isQuizKind,
  makeQuestion,
  shuffleQuiz,
  type QuizKind,
  type QuizQuestion,
} from '../../core/quiz'
import { isDue, reviewItem } from '../../core/vocab'
import type { VocabItem, VocabLibrary } from '../../types/document'
import { vocabMistake, type MistakeEntry } from '../../core/mistakes'
import type { ActivityCat } from '../../core/activity'
import type { PracticeKind } from '../../core/practice'
import { useLocalStorageState, persistentBool, persistentBoolTrue, persistentEnum, persistentNumber } from './useLocalStorageState'

/** 考试范围。 */
export type QuizScope = 'all' | 'article' | 'unmastered' | 'due' | 'lapses'

export interface QuizResultRow {
  id: string
  itemId: string
  correct: boolean
}

export interface UseQuizSessionParams {
  library: VocabLibrary
  articleIdentity: string
  docLemmas: Set<string>
  /** 开始一轮考试时关掉其它会话（背单词/听写/快刷）。 */
  closeOthers: () => void
  speak: (text: string) => void
  flash: (message: string) => void
  persist: (library: VocabLibrary) => void
  markStudied: (itemId: string) => void
  recordActivity: (cat: ActivityCat, n?: number) => void
  recordPractice: (kind: PracticeKind, total: number, correct: number) => void
  addMistake: (entry: MistakeEntry) => void
  dropMistake: (id: string) => void
}

/**
 * 考试会话：设置（题型/范围/题量/选项）、出卷、判分、自动下一题、错题重做、快捷键。
 * 对 → SRS good，错 → SRS again（记 lapse），并同步错题本。
 */
export function useQuizSession(params: UseQuizSessionParams) {
  const {
    library,
    articleIdentity,
    docLemmas,
    closeOthers,
    speak,
    flash,
    persist,
    markStudied,
    recordActivity,
    recordPractice,
    addMistake,
    dropMistake,
  } = params

  // ---- 设置（持久化） ----
  const [kinds, setKinds] = useLocalStorageState<QuizKind[]>('reader:quizKinds', ['spell', 'cloze', 'usage'], {
    parse: (raw) => {
      try {
        const arr = JSON.parse(raw)
        if (Array.isArray(arr)) {
          const valid = arr.filter(isQuizKind)
          if (valid.length) return valid
        }
      } catch {
        // 忽略
      }
      return ['spell', 'cloze', 'usage']
    },
  })
  const [scope, setScope] = useLocalStorageState<QuizScope>(
    'reader:quizScope',
    'article',
    persistentEnum(['all', 'article', 'unmastered', 'due', 'lapses'] as const, 'article'),
  )
  const [limit, setLimit] = useLocalStorageState('reader:quizLimit', 20, persistentNumber)
  const [auto, setAuto] = useLocalStorageState('reader:quizAuto', false, persistentBool)
  const [unique, setUnique] = useLocalStorageState('reader:quizUnique', true, persistentBoolTrue)
  const [speakAfter, setSpeakAfter] = useLocalStorageState('reader:quizSpeak', true, persistentBoolTrue)

  // ---- 会话 ----
  const [setupOpen, setSetupOpen] = useState(false)
  const [queue, setQueue] = useState<QuizQuestion[] | null>(null)
  const [index, setIndex] = useState(0)
  const [input, setInput] = useState('')
  const [checked, setChecked] = useState(false)
  const [result, setResult] = useState<boolean | null>(null)
  const [results, setResults] = useState<QuizResultRow[]>([])
  const [seconds, setSeconds] = useState(0)
  /** 本轮是否自动切题（开始一轮时按设置快照）。 */
  const [autoRun, setAutoRun] = useState(false)
  const advanceRef = useRef<number | null>(null)
  const recordedRef = useRef(false)

  // ---- 候选池与题量 ----
  const pool = useMemo(() => {
    if (scope === 'all') return library.items
    if (scope === 'due') return library.items.filter((it) => isDue(it))
    if (scope === 'lapses') return library.items.filter((it) => (it.reviewState.lapses ?? 0) > 0)
    if (scope === 'unmastered') return library.items.filter((it) => it.status !== 'mastered')
    return library.items.filter((it) => it.source?.fileName === articleIdentity || docLemmas.has(it.lemma))
  }, [library.items, scope, articleIdentity, docLemmas])
  const poolSizes = useMemo(() => {
    const count = (items: VocabItem[]) => countQuestions(items, kinds)
    return {
      all: count(library.items),
      due: count(library.items.filter((it) => isDue(it))),
      unmastered: count(library.items.filter((it) => it.status !== 'mastered')),
    }
  }, [library.items, kinds])
  const availableCount = useMemo(() => countQuestions(pool, kinds), [pool, kinds])

  /** 出题：默认每个单词只考一次、题型随机；可关掉以允许同一词多题型。 */
  const buildSet = useCallback(
    (items: VocabItem[]): QuizQuestion[] => {
      if (!unique) return buildQuizQuestions(items, kinds)
      return shuffleQuiz(items)
        .map((it) => {
          for (const k of shuffleQuiz(kinds)) {
            const q = makeQuestion(it, k, items)
            if (q) return q
          }
          return null
        })
        .filter((q): q is QuizQuestion => q !== null)
    },
    [unique, kinds],
  )

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
    setResult(null)
    setIndex((i) => i + 1)
  }, [clearAdvance])

  /** 用一批题开一轮考试（内部复用）。 */
  const begin = useCallback(
    (qs: QuizQuestion[]) => {
      if (!qs.length) {
        flash('这个范围/题型下没题可出（词条可能缺释义或例句）')
        return
      }
      clearAdvance()
      closeOthers()
      setQueue(shuffleQuiz(qs))
      setIndex(0)
      setInput('')
      setChecked(false)
      setResult(null)
      setResults([])
      recordedRef.current = false
      setAutoRun(auto)
      setSetupOpen(false)
    },
    [clearAdvance, closeOthers, auto, flash],
  )

  /** 用当前设置出一份考卷（洗牌 + 限量）。 */
  const start = useCallback(() => {
    const qs = buildSet(pool)
    if (!qs.length) {
      flash('这个范围/题型下没题可出（词条可能缺释义或例句）')
      return
    }
    begin(shuffleQuiz(qs).slice(0, limit > 0 ? limit : qs.length))
  }, [buildSet, pool, limit, begin, flash])

  /** 从指定词条开一轮考试（错题本「重练词汇」用）。 */
  const startItems = useCallback(
    (ids: string[]) => {
      const items = library.items.filter((it) => ids.includes(it.id))
      const qs = buildSet(items)
      if (!qs.length) {
        flash('这些词暂时出不了题（缺释义 / 例句）')
        return
      }
      begin(qs)
    },
    [library.items, buildSet, begin, flash],
  )

  /** 提交本题并判分；对 → SRS good，错 → SRS again（记 lapse）。 */
  const check = useCallback(
    (answerOverride?: string) => {
      if (!queue) return
      const q = queue[index]
      if (!q || checked) return
      const ans = answerOverride ?? input
      const ok = isCorrect(q, ans)
      setChecked(true)
      setResult(ok)
      setResults((r) => [...r, { id: q.id, itemId: q.itemId, correct: ok }])
      if (ok) dropMistake(`vocab:${q.itemId}`)
      else addMistake(vocabMistake(q.itemId, q.word, new Date().toISOString()))
      persist(reviewItem(library, q.itemId, ok ? 'good' : 'again'))
      markStudied(q.itemId)
      recordActivity(q.kind === 'listen' || q.kind === 'ear' ? 'listen' : 'vocab', 1)
      // 答完朗读一下（看词选义读英文单词；其余读答案词形）
      if (speakAfter) speak(q.kind === 'meaning' ? q.word : q.answer)
      // 开了「自动下一题」：答对快切、答错稍停（看答案）后自动切
      if (autoRun) {
        if (advanceRef.current) window.clearTimeout(advanceRef.current)
        advanceRef.current = window.setTimeout(
          () => {
            advanceRef.current = null
            next()
          },
          ok ? 650 : 1400,
        )
      }
    },
    [queue, index, checked, input, library, persist, autoRun, next, markStudied, speakAfter, speak, recordActivity, addMistake, dropMistake],
  )

  /** 关闭考试并清掉待触发的自动切题（也顺手关掉设置面板）。 */
  const close = useCallback(() => {
    clearAdvance()
    setQueue(null)
    setSetupOpen(false)
  }, [clearAdvance])

  const retryWrong = useCallback(() => {
    const wrongIds = new Set(results.filter((r) => !r.correct).map((r) => r.itemId))
    const items = library.items.filter((it) => wrongIds.has(it.id))
    const qs = buildSet(items)
    if (!qs.length) {
      flash('没有可重做的错题')
      return
    }
    clearAdvance()
    setQueue(shuffleQuiz(qs))
    setIndex(0)
    setInput('')
    setChecked(false)
    setResult(null)
    setResults([])
    recordedRef.current = false
  }, [results, library.items, buildSet, clearAdvance, flash])

  // 计时：开考清零，每秒 +1
  useEffect(() => {
    if (!queue) return
    setSeconds(0)
    const id = window.setInterval(() => setSeconds((s) => s + 1), 1000)
    return () => window.clearInterval(id)
  }, [queue])

  // 考试完成 → 记一次成绩
  useEffect(() => {
    if (!queue) {
      recordedRef.current = false
      return
    }
    if (index >= queue.length && results.length > 0 && !recordedRef.current) {
      recordedRef.current = true
      recordPractice('quiz', results.length, results.filter((r) => r.correct).length)
    }
  }, [queue, index, results, recordPractice])

  // 卸载时清掉待触发的自动切题
  useEffect(() => {
    return () => {
      if (advanceRef.current) window.clearTimeout(advanceRef.current)
    }
  }, [])

  // 快捷键：回车 提交 / 下一题；词形辨析可用 1/2/3 选选项；Esc 退出
  useEffect(() => {
    if (!queue) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        close()
        return
      }
      const q = queue[index]
      if (e.key === 'Enter') {
        e.preventDefault()
        if (index >= queue.length) return
        if (!checked) check()
        else next()
        return
      }
      if ((q?.kind === 'choice' || q?.kind === 'meaning') && !checked && q.options) {
        const n = Number(e.key)
        if (n >= 1 && n <= q.options.length) {
          e.preventDefault()
          const opt = q.options[n - 1]
          setInput(opt)
          check(opt)
        }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [queue, index, checked, check, next, close])

  return {
    // 设置
    kinds,
    setKinds,
    scope,
    setScope,
    limit,
    setLimit,
    auto,
    setAuto,
    unique,
    setUnique,
    speakAfter,
    setSpeakAfter,
    // 会话
    setupOpen,
    setSetupOpen,
    queue,
    setQueue,
    index,
    input,
    setInput,
    checked,
    result,
    results,
    setResults,
    seconds,
    // 派生
    poolSizes,
    availableCount,
    // 动作
    start,
    startItems,
    check,
    next,
    close,
    retryWrong,
  }
}
