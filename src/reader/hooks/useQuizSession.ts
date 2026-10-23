import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { countQuestions, isCorrect, shuffleQuiz, type QuizKind, type QuizQuestion } from '../../core/quiz'
import { buildArticleQuestions } from '../../core/articleQuiz'
import { nextDayIso, prioritizeItems, reviewItem, markSpellingMiss } from '../../core/vocab'
import { buildQuizSet, poolFor, poolSizes, studyableItems, type QuizScope } from '../../core/quizPool'
import { isArticleKind } from '../../core/quiz'
import type { Sentence, VocabItem, VocabLibrary } from '../../types/document'

/** 「反复鞭打」最多自动重练几轮（防死循环）。 */
const MAX_DRILL_ROUNDS = 5

import { vocabMistake, type MistakeEntry } from '../../core/mistakes'
import type { ActivityCat } from '../../core/activity'
import type { AnswerEventInput } from '../../core/answerEvents'
import type { PracticeKind } from '../../core/practice'
import { useQuizSettings } from './useQuizSettings'
import { useHotkeys } from '../useHotkeys'
import {
  parseQuizSessionSnapshot,
  type QuizResultRow,
  type QuizSessionSnapshot,
} from '../../core/sessionSnapshots'

export type { QuizResultRow } from '../../core/sessionSnapshots'
export type { QuizScope } from '../../core/quizPool'

const QUIZ_SESSION_KEY = 'reader:quizSession'

/** 拷打前「先学一遍」的预习卡。 */
export interface DrillWarmupCard {
  id: string
  word: string
  phonetic?: string
  meaning?: string
  /** 词块拷打要看的：用法 / 词组 / 习语 */
  chunks: string[]
  /** 记忆拷打给一条例句当语境 */
  example?: string
}

/** 预习态：题目已经出好，等人看完再开考。 */
export interface DrillWarmupState {
  /** memory = 记忆拷打（词·搭配），chunk = 词块拷打（词块·搭配） */
  kind: 'memory' | 'chunk'
  title: string
  cards: DrillWarmupCard[]
  /** 点「开始拷打」时才真正进队列 */
  questions: QuizQuestion[]
  article: boolean
}

/** 由题目反推「这轮会考到哪些词」，取词条内容做成预习卡（题目是唯一事实来源，不另写筛选）。 */
export function buildWarmupCards(
  items: VocabItem[],
  questions: QuizQuestion[],
  kind: 'memory' | 'chunk',
): DrillWarmupCard[] {
  const byId = new Map(items.map((it) => [it.id, it]))
  const seen = new Set<string>()
  const cards: DrillWarmupCard[] = []
  for (const q of questions) {
    if (seen.has(q.itemId)) continue
    seen.add(q.itemId)
    const it = byId.get(q.itemId)
    if (!it) continue
    cards.push({
      id: it.id,
      word: it.word,
      phonetic: it.phonetic ?? undefined,
      meaning: it.meaning ?? undefined,
      chunks:
        kind === 'chunk'
          ? [...(it.phrases ?? []), ...(it.idioms ?? []), ...(it.usage ?? [])].filter(Boolean).slice(0, 6)
          : [],
      example: kind === 'memory' ? (it.examples.find((e) => e.text.trim())?.text ?? undefined) : undefined,
    })
  }
  return cards
}

function loadQuizSession(): QuizSessionSnapshot | null {
  try {
    return parseQuizSessionSnapshot(localStorage.getItem(QUIZ_SESSION_KEY))
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
  /** 每题追加一条答题事件（可选；旧调用方不传就只写聚合值）。 */
  recordAnswer?: (event: AnswerEventInput) => void
  addMistake: (entry: MistakeEntry) => void
  dropMistake: (id: string) => void
  /** 一轮考完时按题型汇总（做「词块/搭配正确率」等量化）。 */
  onKinds?: (rows: { kind: QuizKind; total: number; correct: number }[]) => void
  /** 拼错后「从头重学」：交给背单词会话按完整流程重学这些词。 */
  onRelearn?: (ids: string[]) => void
}

/**
 * 考试会话：出卷、判分、自动下一题、错题重做、快捷键。
 * 对 → SRS good，错 → SRS again（记 lapse），并同步错题本。
 *
 * 设置（题型/范围/题量…）在 `useQuizSettings`；候选池与出题集在 `core/quizPool`。
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
    recordAnswer,
    addMistake,
    dropMistake,
    onKinds,
    onRelearn,
  } = params

  // ---- 设置（持久化，逻辑在 useQuizSettings） ----
  const settings = useQuizSettings()
  const { kinds, setKinds, scope, setScope, limit, auto, unique, speakAfter, articleKinds, setArticleKinds, loopWrong } =
    settings

  /** 本轮是不是「文章测验」（决定面板标题、且不写 SRS）。 */
  const [articleRun, setArticleRun] = useState(false)
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
  /** 拼写题拼错：判定提示（非空时不许直接切题 / 退出）。 */
  const [spellMiss, setSpellMiss] = useState<{ itemId: string; word: string; input: string } | null>(null)
  /** 「先学一遍再考」的预习态（null = 直接考）。 */
  const [warmup, setWarmup] = useState<DrillWarmupState | null>(null)
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

  // ---- 候选池与题量（规则在 core/quizPool） ----
  /** 可考的：用法笔记（中文说明）不出题 */
  const studyable = useMemo(() => studyableItems(library.items), [library.items])
  const poolCtx = useMemo(() => ({ articleIdentity, docLemmas }), [articleIdentity, docLemmas])
  const pool = useMemo(() => poolFor(studyable, scope, poolCtx), [studyable, scope, poolCtx])
  const poolSizesNow = useMemo(() => poolSizes(studyable, kinds), [studyable, kinds])
  const availableCount = useMemo(() => countQuestions(pool, kinds), [pool, kinds])

  const clearAdvance = useCallback(() => {
    if (advanceRef.current) {
      window.clearTimeout(advanceRef.current)
      advanceRef.current = null
    }
  }, [])

  /** 真正切到下一题（不再做「拼错必须先确认」的拦截）。 */
  const advance = useCallback(() => {
    clearAdvance()
    setInput('')
    setChecked(false)
    setResult(null)
    setIndex((i) => i + 1)
  }, [clearAdvance])

  /** 用户点「下一题」：拼错判定未确认时停在这一题。 */
  const next = useCallback(() => {
    if (spellMiss) return
    advance()
  }, [spellMiss, advance])

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
      setSpellMiss(null)
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
    const ks = articleKinds.filter(isArticleKind)
    const qs = buildArticleQuestions(sents, { kinds: ks })
    if (!qs.length) {
      flash('文章测验没题可出（缺译文 / 语言点，或句子太少）')
      return
    }
    begin(shuffleQuiz(qs).slice(0, limit > 0 ? limit : qs.length), { article: true })
  }, [doc, articleKinds, limit, begin, flash])

  /** 用当前设置出一份考卷（洗牌 + 限量）。 */
  const start = useCallback(() => {
    const qs = buildQuizSet(pool, kinds, unique)
    if (!qs.length) {
      flash('这个范围/题型下没题可出（词条可能缺释义或例句）')
      return
    }
    begin(shuffleQuiz(qs).slice(0, limit > 0 ? limit : qs.length))
  }, [pool, kinds, unique, limit, begin, flash])

  /** 从指定词条开一轮考试（错题本「重练词汇」/ 错题包围战 用）。可指定题型。 */
  const startItems = useCallback(
    (ids: string[], kindsArg?: QuizKind[]) => {
      const items = library.items.filter((it) => ids.includes(it.id))
      const qs = buildQuizSet(items, kindsArg ?? kinds, unique)
      if (!qs.length) {
        flash('这些词暂时出不了题（缺释义 / 例句）')
        return
      }
      if (kindsArg) setKinds(kindsArg)
      begin(qs)
    },
    [library.items, kinds, unique, begin, flash, setKinds],
  )

  /**
   * 精读工作流：用指定题型 / 范围直接开一轮「拷打」。
   *
   * `opts.warmup`：先给一张「这轮要考的词」预习卡（词 + 释义 + 词块），看完再开考。
   * 记忆/词块两档拷打是**闭卷回忆**，直接上来就考等于让用户猜 —— 先过一遍认一遍，
   * 考出来的分才有意义（也让「词块拷打」第一次就能看到词组长什么样）。
   */
  const startDrill = useCallback(
    (ks: QuizKind[], scopeArg: QuizScope = 'article', opts?: { warmup?: 'memory' | 'chunk' }) => {
      const vocabKinds = ks.filter((k) => !isArticleKind(k))
      const qs = buildQuizSet(poolFor(studyable, scopeArg, poolCtx), vocabKinds, unique)
      if (!qs.length) {
        flash('这个范围/题型下没题可出（词条可能缺释义或例句）')
        return
      }
      setKinds(ks)
      setScope(scopeArg)
      const picked = shuffleQuiz(qs).slice(0, limit > 0 ? limit : qs.length)
      if (opts?.warmup) {
        const cards = buildWarmupCards(library.items, picked, opts.warmup)
        setWarmup({
          kind: opts.warmup,
          title: opts.warmup === 'chunk' ? '词块拷打 · 先看一遍' : '记忆拷打 · 先看一遍',
          cards,
          questions: picked,
          article: false,
        })
        return
      }
      begin(picked)
    },
    [studyable, poolCtx, unique, limit, begin, flash, setKinds, setScope, library.items],
  )

  /** 看完预习卡，开始拷打。 */
  const beginWarmup = useCallback(() => {
    const w = warmup
    if (!w) return
    setWarmup(null)
    begin(w.questions, { article: w.article })
  }, [warmup, begin])

  /** 关掉预习卡（本轮不考）。 */
  const cancelWarmup = useCallback(() => setWarmup(null), [])

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
      // 拼写错 = 不认识：SRS again + 「不认识」标签 + 进入重学（不是普通错题）
      const spellingKind = q.kind === 'spell' || q.kind === 'ear' || q.kind === 'define'
      // 文章题不写 SRS / 错题本（那是词级的）
      if (!isArticle) {
        if (ok) dropMistake(`vocab:${q.itemId}`)
        else addMistake(vocabMistake(q.itemId, q.word, new Date().toISOString()))
        // 拼写错 = 不认识：SRS again + 「不认识」标签 + 进入重学（不是普通错题）
        const reviewed =
          !ok && spellingKind ? markSpellingMiss(library, q.itemId) : reviewItem(library, q.itemId, ok ? 'good' : 'again')
        persist(ok ? reviewed : prioritizeItems(reviewed, [q.itemId], nextDayIso()))
        markStudied(q.itemId)
      }
      // 拼写错：锁在本题，必须确认（可立即重学，或继续考但该词已排队重学）
      if (!ok && spellingKind && !isArticle) {
        setSpellMiss({ itemId: q.itemId, word: q.word, input: ans })
      }
      recordActivity(isArticle ? 'read' : q.kind === 'listen' || q.kind === 'ear' ? 'listen' : 'vocab', 1)
      recordAnswer?.({
        articleId: articleIdentity,
        source: 'quiz',
        kind: q.kind,
        cat: isArticle ? 'read' : q.kind === 'listen' || q.kind === 'ear' ? 'listen' : 'vocab',
        correct: ok,
        questionId: q.id,
      })
      // 答完朗读一下（看词选义读英文单词；其余读答案词形）
      if (speakAfter) speak(q.kind === 'meaning' ? q.word : q.answer)
      // 开了「自动下一题」：答对快切、答错稍停（看答案）后自动切；拼写错必须先确认
      if (autoRun && !(!ok && spellingKind && !isArticle)) {
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
    [queue, index, checked, input, library, persist, autoRun, next, markStudied, speakAfter, speak, recordActivity, recordAnswer, articleIdentity, addMistake, dropMistake],
  )

  /** 关闭考试并清掉待触发的自动切题（也顺手关掉设置面板）。 */
  const closeSession = useCallback(() => {
    clearAdvance()
    if (drillTimerRef.current) {
      window.clearTimeout(drillTimerRef.current)
      drillTimerRef.current = null
    }
    setQueue(null)
    setSetupOpen(false)
    setArticleRun(false)
    setSpellMiss(null)
  }, [clearAdvance])

  /** 拼写判错未确认时，不允许直接结束把这次判罚吞掉。 */
  const close = useCallback(() => {
    if (spellMiss) {
      flash('拼错了：先确认「已判为不认识」，再结束考试')
      return
    }
    setWarmup(null)
    closeSession()
  }, [spellMiss, flash, closeSession])

  /** 确认拼写判错，继续下一题（该词已进重学队列）。 */
  const ackSpellMiss = useCallback(() => {
    if (!spellMiss) return
    setSpellMiss(null)
    advance()
  }, [spellMiss, advance])

  /** 立即从头重学拼错的词：关掉考试，交给背单词会话走完整流程。 */
  const relearnSpellMiss = useCallback(() => {
    if (!spellMiss) return
    const id = spellMiss.itemId
    closeSession()
    onRelearn?.([id])
  }, [spellMiss, closeSession, onRelearn])

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
    setSpellMiss(null)
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
  useHotkeys(
    (e) => {
      if (!queue) return
      if (e.key === 'Escape') {
        close()
        return
      }
      const q = queue[index]
      if (e.key === 'Enter') {
        e.preventDefault()
        if (spellMiss) {
          ackSpellMiss()
          return
        }
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
    },
    !!queue,
    60,
  )

  return {
    // 设置（原样转发 useQuizSettings 的那一批）
    ...settings,
    articleRun,
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
    /** 拼写错判定提示；非空时禁止直接切题 / 结束。 */
    spellMiss,
    seconds,
    /** 「先学一遍再考」的预习卡（有内容时面板先画它，队列还没开始） */
    warmup,
    beginWarmup,
    cancelWarmup,
    // 派生
    poolSizes: poolSizesNow,
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
    forceClose: closeSession,
    ackSpellMiss,
    relearnSpellMiss,
    retryWrong,
  }
}
