import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ARTICLE_KINDS,
  buildQuizQuestions,
  countQuestions,
  isCorrect,
  isQuizKind,
  makeQuestion,
  shuffleQuiz,
  type ArticleQuizKind,
  type QuizKind,
  type QuizQuestion,
} from '../../core/quiz'
import { buildArticleQuestions } from '../../core/articleQuiz'
import { isDue, nextDayIso, prioritizeItems, reviewItem } from '../../core/vocab'
import { isStudyable } from '../../core/entryKind'
import type { Sentence, VocabItem, VocabLibrary } from '../../types/document'

const DEFAULT_ARTICLE_KINDS: QuizKind[] = ['translate', 'translate2', 'functionWord', 'ordering', 'phraseBlank']
/** 「反复鞭打」最多自动重练几轮（防死循环）。 */
const MAX_DRILL_ROUNDS = 5
const isArticleKind = (k: QuizKind): k is ArticleQuizKind => (ARTICLE_KINDS as readonly string[]).includes(k)
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

/** 考试会话快照（落 localStorage，刷新后接着考）。 */
interface QuizSessionSnapshot {
  v: 1
  queue: QuizQuestion[]
  index: number
  input: string
  checked: boolean
  result: boolean | null
  results: QuizResultRow[]
  autoRun: boolean
}

const QUIZ_SESSION_KEY = 'reader:quizSession'

function loadQuizSession(): QuizSessionSnapshot | null {
  try {
    const raw = localStorage.getItem(QUIZ_SESSION_KEY)
    if (!raw) return null
    const s = JSON.parse(raw) as QuizSessionSnapshot
    if (!s || s.v !== 1 || !Array.isArray(s.queue) || !s.queue.length) return null
    return s
  } catch {
    return null
  }
}

export interface UseQuizSessionParams {
  library: VocabLibrary
  articleIdentity: string
  docLemmas: Set<string>
  /** 当前文章（文章级测验要句子/译文/语言点）。 */
  doc: { sentences: Sentence[] } | null
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
  /** 一轮考完时按题型汇总（做「词块/搭配正确率」等量化）。 */
  onKinds?: (rows: { kind: QuizKind; total: number; correct: number }[]) => void
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
    doc,
    closeOthers,
    speak,
    flash,
    persist,
    markStudied,
    recordActivity,
    recordPractice,
    addMistake,
    dropMistake,
    onKinds,
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
  /** 文章级测验题型（英译中 / 中译英 / 功能词填空 / 句子排序 / 结构语法）。 */
  const [articleKinds, setArticleKinds] = useLocalStorageState<QuizKind[]>('reader:quizArticleKinds', DEFAULT_ARTICLE_KINDS, {
    parse: (raw) => {
      try {
        const arr = JSON.parse(raw)
        if (Array.isArray(arr)) {
          const valid = arr.filter((k) => isQuizKind(k) && isArticleKind(k))
          if (valid.length) return valid
        }
      } catch {
        // 忽略
      }
      return DEFAULT_ARTICLE_KINDS
    },
  })
  /** 本轮是不是「文章测验」（决定面板标题、且不写 SRS）。 */
  const [articleRun, setArticleRun] = useState(false)
  /** 反复鞭打：一轮没全对就自动重练错题（最多 MAX_DRILL_ROUNDS 轮）。 */
  const [loopWrong, setLoopWrong] = useLocalStorageState('reader:quizLoopWrong', false, persistentBool)
  const [drillRound, setDrillRound] = useState(0)
  const drillRoundRef = useRef(0)
  /** 鞭打轮的定时器（换轮/关闭时清掉）。 */
  const drillTimerRef = useRef<number | null>(null)

  // ---- 会话（落盘：刷新可恢复，刷新也是解除 TTS 假死的办法） ----
  const [restored] = useState<QuizSessionSnapshot | null>(loadQuizSession)
  const [setupOpen, setSetupOpen] = useState(false)
  const [queue, setQueue] = useState<QuizQuestion[] | null>(restored?.queue ?? null)
  const [index, setIndex] = useState(restored?.index ?? 0)
  const [input, setInput] = useState(restored?.input ?? '')
  const [checked, setChecked] = useState(restored?.checked ?? false)
  const [result, setResult] = useState<boolean | null>(restored?.result ?? null)
  const [results, setResults] = useState<QuizResultRow[]>(restored?.results ?? [])
  const [seconds, setSeconds] = useState(0)
  /** 本轮是否自动切题（开始一轮时按设置快照）。 */
  const [autoRun, setAutoRun] = useState(restored?.autoRun ?? false)
  const advanceRef = useRef<number | null>(null)
  /** 本轮全部题目（重做错题按 id 从这里取，词/文章通用）。 */
  const allRef = useRef<QuizQuestion[]>([])
  // 恢复的会话若已完成，别在挂载时把成绩再记一遍
  const recordedRef = useRef(!!restored && restored.index >= restored.queue.length)

  // 会话落盘：刷新页面后能接着考
  useEffect(() => {
    try {
      if (queue && queue.length) {
        const snap: QuizSessionSnapshot = { v: 1, queue, index, input, checked, result, results, autoRun }
        localStorage.setItem(QUIZ_SESSION_KEY, JSON.stringify(snap))
      } else {
        localStorage.removeItem(QUIZ_SESSION_KEY)
      }
    } catch {
      // 隐私模式 / 配额满：忽略
    }
  }, [queue, index, input, checked, result, results, autoRun])

  // ---- 候选池与题量 ----
  /** 可考的：用法笔记（中文说明）不出题 */
  const studyable = useMemo(() => library.items.filter(isStudyable), [library.items])
  /** 按范围取候选词（考试 / 拷打共用）。 */
  const poolFor = useCallback(
    (s: QuizScope): VocabItem[] => {
      if (s === 'all') return studyable
      if (s === 'due') return studyable.filter((it) => isDue(it))
      if (s === 'lapses') return studyable.filter((it) => (it.reviewState.lapses ?? 0) > 0)
      if (s === 'unmastered') return studyable.filter((it) => it.status !== 'mastered')
      return studyable.filter((it) => it.source?.fileName === articleIdentity || docLemmas.has(it.lemma))
    },
    [studyable, articleIdentity, docLemmas],
  )
  const pool = useMemo(() => poolFor(scope), [poolFor, scope])
  const poolSizes = useMemo(() => {
    const count = (items: VocabItem[]) => countQuestions(items, kinds)
    return {
      all: count(studyable),
      due: count(studyable.filter((it) => isDue(it))),
      unmastered: count(studyable.filter((it) => it.status !== 'mastered')),
    }
  }, [studyable, kinds])
  const availableCount = useMemo(() => countQuestions(pool, kinds), [pool, kinds])

  /** 出题：默认每个单词只考一次、题型随机；可关掉以允许同一词多题型。 */
  const buildSetWith = useCallback(
    (items: VocabItem[], ks: QuizKind[]): QuizQuestion[] => {
      if (!unique) return buildQuizQuestions(items, ks)
      return shuffleQuiz(items)
        .map((it) => {
          for (const k of shuffleQuiz(ks)) {
            const q = makeQuestion(it, k, items)
            if (q) return q
          }
          return null
        })
        .filter((q): q is QuizQuestion => q !== null)
    },
    [unique],
  )

  const buildSet = useCallback((items: VocabItem[]): QuizQuestion[] => buildSetWith(items, kinds), [buildSetWith, kinds])

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
    (qs: QuizQuestion[], opts?: { article?: boolean }) => {
      if (!qs.length) {
        flash('这个范围/题型下没题可出（词条可能缺释义或例句）')
        return
      }
      clearAdvance()
      closeOthers()
      allRef.current = qs
      drillRoundRef.current = 0
      setDrillRound(0)
      setArticleRun(!!opts?.article)
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

  /** 文章级测验：按当前文章出题（英译中/中译英/功能词填空/句子排序/结构语法）。 */
  const startArticle = useCallback(() => {
    const sents = doc?.sentences ?? []
    const kinds = articleKinds.filter(isArticleKind)
    const qs = buildArticleQuestions(sents, { kinds })
    if (!qs.length) {
      flash('文章测验没题可出（缺译文 / 语言点，或句子太少）')
      return
    }
    begin(shuffleQuiz(qs).slice(0, limit > 0 ? limit : qs.length), { article: true })
  }, [doc, articleKinds, limit, begin, flash])

  /** 用当前设置出一份考卷（洗牌 + 限量）。 */
  const start = useCallback(() => {
    const qs = buildSet(pool)
    if (!qs.length) {
      flash('这个范围/题型下没题可出（词条可能缺释义或例句）')
      return
    }
    begin(shuffleQuiz(qs).slice(0, limit > 0 ? limit : qs.length))
  }, [buildSet, pool, limit, begin, flash])

  /** 从指定词条开一轮考试（错题本「重练词汇」/ 错题包围战 用）。可指定题型。 */
  const startItems = useCallback(
    (ids: string[], kindsArg?: QuizKind[]) => {
      const items = library.items.filter((it) => ids.includes(it.id))
      const qs = buildSetWith(items, kindsArg ?? kinds)
      if (!qs.length) {
        flash('这些词暂时出不了题（缺释义 / 例句）')
        return
      }
      if (kindsArg) setKinds(kindsArg)
      begin(qs)
    },
    [library.items, buildSetWith, kinds, begin, flash, setKinds],
  )

  /** 精读工作流：用指定题型 / 范围直接开一轮「拷打」。 */
  const startDrill = useCallback(
    (ks: QuizKind[], scopeArg: QuizScope = 'article') => {
      const vocabKinds = ks.filter((k) => !isArticleKind(k))
      const qs = buildSetWith(poolFor(scopeArg), vocabKinds)
      if (!qs.length) {
        flash('这个范围/题型下没题可出（词条可能缺释义或例句）')
        return
      }
      setKinds(ks)
      setScope(scopeArg)
      begin(shuffleQuiz(qs).slice(0, limit > 0 ? limit : qs.length))
    },
    [poolFor, buildSetWith, limit, begin, flash, setKinds, setScope],
  )

  /** 精读工作流：用指定文章级题型开一轮（结构/语法、中译英、功能词、排序）。 */
  const startArticleDrill = useCallback(
    (ks: QuizKind[]) => {
      const sents = doc?.sentences ?? []
      const qs = buildArticleQuestions(sents, { kinds: ks.filter(isArticleKind) })
      if (!qs.length) {
        flash('文章测验没题可出（缺译文 / 语言点，或句子太少）')
        return
      }
      setArticleKinds(ks)
      begin(shuffleQuiz(qs).slice(0, limit > 0 ? limit : qs.length), { article: true })
    },
    [doc, limit, begin, flash, setArticleKinds],
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
      const isArticle = q.source === 'article'
      // 文章题不写 SRS / 错题本（那是词级的）
      if (!isArticle) {
        if (ok) dropMistake(`vocab:${q.itemId}`)
        else addMistake(vocabMistake(q.itemId, q.word, new Date().toISOString()))
        // 答错 → 进错题本 + 标「次日优先重排」（明天队列排最前）
        const reviewed = reviewItem(library, q.itemId, ok ? 'good' : 'again')
        persist(ok ? reviewed : prioritizeItems(reviewed, [q.itemId], nextDayIso()))
        markStudied(q.itemId)
      }
      recordActivity(isArticle ? 'read' : q.kind === 'listen' || q.kind === 'ear' ? 'listen' : 'vocab', 1)
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
    if (drillTimerRef.current) {
      window.clearTimeout(drillTimerRef.current)
      drillTimerRef.current = null
    }
    setQueue(null)
    setSetupOpen(false)
    setArticleRun(false)
  }, [clearAdvance])

  const retryWrong = useCallback(() => {
    // 按题目 id 从本轮全部题目里取错题（词级 / 文章级通用）
    const wrongIds = new Set(results.filter((r) => !r.correct).map((r) => r.id))
    const qs = allRef.current.filter((q) => wrongIds.has(q.id))
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
  }, [results, clearAdvance, flash])

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
      // 按题型汇总（词块/搭配正确率等量化用）
      if (onKinds) {
        const kindOf = new Map(queue.map((q) => [q.id, q.kind]))
        const tally = new Map<QuizKind, { total: number; correct: number }>()
        for (const r of results) {
          const k = kindOf.get(r.id)
          if (!k) continue
          const cur = tally.get(k) ?? { total: 0, correct: 0 }
          cur.total += 1
          if (r.correct) cur.correct += 1
          tally.set(k, cur)
        }
        if (tally.size) onKinds([...tally].map(([kind, s]) => ({ kind, ...s })))
      }
      // 反复鞭打：还有错题就自动重练（上限 MAX_DRILL_ROUNDS 轮，避免死循环）
      const wrong = results.filter((r) => !r.correct).length
      if (loopWrong && wrong > 0 && drillRoundRef.current < MAX_DRILL_ROUNDS) {
        drillRoundRef.current += 1
        setDrillRound(drillRoundRef.current)
        setAutoRun(true) // 鞭打轮自动切题，别停下来
        drillTimerRef.current = window.setTimeout(() => {
          drillTimerRef.current = null
          retryWrong()
        }, 1500)
      }
    }
  }, [queue, index, results, recordPractice, onKinds, loopWrong, retryWrong])

  // 卸载时清掉待触发的自动切题
  useEffect(() => {
    return () => {
      if (advanceRef.current) window.clearTimeout(advanceRef.current)
      if (drillTimerRef.current) window.clearTimeout(drillTimerRef.current)
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
      if (q?.options && !checked) {
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
    articleKinds,
    setArticleKinds,
    articleRun,
    loopWrong,
    setLoopWrong,
    drillRound,
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
    startArticle,
    startItems,
    startDrill,
    startArticleDrill,
    check,
    next,
    close,
    retryWrong,
  }
}
