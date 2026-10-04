import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  buildLearnQueue,
  buildReviewQueue,
  editItem,
  isDue,
  removeItem,
  reviewItem,
  sortItems,
  type ReviewGrade,
  type StudyMode,
} from '../../core/vocab'
import type { VocabItem, VocabLibrary } from '../../types/document'
import type { ActivityCat } from '../../core/activity'
import { fmtInterval } from '../format'
import { useLocalStorageState, persistentBool, persistentEnum } from './useLocalStorageState'

/** 背单词范围。 */
export type StudyScope = 'all' | 'article' | 'unmastered' | 'lapses'

/** 卡内编辑草稿。 */
export interface StudyDraft {
  word: string
  phonetic: string
  partOfSpeech: string
  meaning: string
  usage: string
}

export interface UseStudySessionParams {
  library: VocabLibrary
  articleIdentity: string
  docLemmas: Set<string>
  /** 开始一轮背单词时关掉正在进行的考试。 */
  closeQuiz: () => void
  flash: (message: string) => void
  persist: (library: VocabLibrary) => void
  markStudied: (itemId: string) => void
  recordActivity: (cat: ActivityCat, n?: number) => void
  /** 把背单词时长 / 评分次数累加到「今天」（落盘供统计）。 */
  addStudyTime: (seconds: number, cards: number) => void
  /** 每天最多引入多少新词（0=不限）与今天已引入数。 */
  newLimit: number
  newToday: number
  onBumpNewToday: () => void
}

/**
 * 背单词会话：模式/范围/队列/评分（SRS）/错题重排/每日新词配额/卡内编辑删除/计时/快捷键。
 *
 * 评分：认识→good、模糊→hard、忘记了→again；忘记/模糊的词本轮末尾再出现（各有上限，防死循环）。
 */
export function useStudySession(params: UseStudySessionParams) {
  const {
    library,
    articleIdentity,
    docLemmas,
    closeQuiz,
    flash,
    persist,
    markStudied,
    recordActivity,
    addStudyTime,
    newLimit,
    newToday,
    onBumpNewToday,
  } = params

  const [scope, setScope] = useLocalStorageState<StudyScope>(
    'reader:studyScope',
    'unmastered',
    persistentEnum(['all', 'article', 'unmastered', 'lapses'] as const, 'unmastered'),
  )
  const [spelling, setSpelling] = useLocalStorageState('reader:studySpelling', false, persistentBool)
  const [mode, setMode] = useLocalStorageState<StudyMode>(
    'reader:studyMode',
    'learn',
    persistentEnum(['learn', 'review'] as const, 'learn'),
  )

  const [queue, setQueue] = useState<VocabItem[] | null>(null)
  const [index, setIndex] = useState(0)
  const [revealed, setRevealed] = useState(false)
  const [input, setInput] = useState('')
  const [checked, setChecked] = useState(false)
  const [counts, setCounts] = useState({ know: 0, fuzzy: 0, forgot: 0 })
  const [live, setLive] = useState(0)
  const liveRef = useRef(0)
  const flushedRef = useRef(0)
  const [cardSeconds, setCardSeconds] = useState(0)
  const [gradeInfo, setGradeInfo] = useState('')
  /** 卡内编辑（改词形/音标/释义/用法）与两步删除 */
  const [editOpen, setEditOpen] = useState(false)
  const [draft, setDraft] = useState<StudyDraft | null>(null)
  const [delArmed, setDelArmed] = useState(false)
  /** 每个词本轮被「忘记/模糊」重排的次数（防死循环） */
  const requeueRef = useRef<Map<string, number>>(new Map())
  /** 本轮点过「忘记了」的词 id，用于收尾重练 */
  const forgotRef = useRef<string[]>([])
  /** 本轮已计入每日新词配额的 id（重排后不重复计数） */
  const bumpedRef = useRef<Set<string>>(new Set())
  /** 供外部（收尾小结）显示「重练忘记的 N 个」 */
  const [forgotCount, setForgotCount] = useState(0)

  // ---- 候选池 ----
  const poolFor = useCallback(
    (s: StudyScope) => {
      if (s === 'all') return library.items
      if (s === 'lapses') return library.items.filter((it) => (it.reviewState.lapses ?? 0) > 0)
      if (s === 'unmastered') return library.items.filter((it) => it.status !== 'mastered')
      // 本篇：来源是本文，或词形出现在正文里（用预计算好的 lemma 集合，O(N)）
      return library.items.filter((it) => it.source?.fileName === articleIdentity || docLemmas.has(it.lemma))
    },
    [library.items, articleIdentity, docLemmas],
  )
  const pool = useMemo(() => poolFor(scope), [poolFor, scope])
  const dueCount = useMemo(() => pool.filter((it) => it.reviewState.repetitions > 0 && isDue(it)).length, [pool])
  const newCount = useMemo(() => pool.filter((it) => it.reviewState.repetitions === 0).length, [pool])

  /** 当前卡：优先取词库最新（评分/编辑后立刻反映），队列快照兜底。 */
  const card =
    queue && index < queue.length ? (library.items.find((it) => it.id === queue[index].id) ?? queue[index]) : null

  const resetSession = useCallback(() => {
    requeueRef.current = new Map()
    forgotRef.current = []
    bumpedRef.current = new Set()
    setForgotCount(0)
    setCounts({ know: 0, fuzzy: 0, forgot: 0 })
    setRevealed(false)
    setInput('')
    setChecked(false)
    setEditOpen(false)
    setDraft(null)
    setDelArmed(false)
  }, [])

  /** 开始背单词：按模式组队（新学习 = 没学过的；复习 = 已学过且到期的）。 */
  const start = useCallback(
    (opts?: { mode?: StudyMode; scope?: StudyScope }) => {
      const nextMode = opts?.mode ?? mode
      const nextScope = opts?.scope ?? scope
      if (opts?.mode != null) setMode(nextMode)
      if (opts?.scope != null) setScope(nextScope)
      const p = poolFor(nextScope)
      const q =
        nextMode === 'review'
          ? buildReviewQueue(p, new Date())
          : buildLearnQueue(p, new Date(), { newLimit, newToday })
      if (!q.length) {
        flash(
          nextMode === 'review'
            ? nextScope === 'article'
              ? '这篇没有到期的复习词'
              : '没有到期的复习词，去「新学习」吧'
            : nextScope === 'article'
              ? '这篇没有待学的新词'
              : '没有待学的新词，去「复习」吧',
        )
        return
      }
      closeQuiz()
      resetSession()
      setQueue(q)
      setIndex(0)
    },
    [poolFor, mode, scope, newLimit, newToday, flash, closeQuiz, resetSession, setMode, setScope],
  )

  const switchMode = useCallback((m: StudyMode) => start({ mode: m }), [start])
  const switchScope = useCallback((s: StudyScope) => start({ scope: s }), [start])

  /** 「本篇全部」：把这篇文章的生词整套过一遍（不分新学/复习、忽略新词配额）。 */
  const startArticleAll = useCallback(() => {
    const p = poolFor('article')
    if (!p.length) {
      flash('这篇还没有生词')
      return
    }
    setScope('article')
    closeQuiz()
    resetSession()
    setQueue(sortItems(p, 'due'))
    setIndex(0)
  }, [poolFor, flash, closeQuiz, resetSession, setScope])

  const grade = useCallback(
    (g: ReviewGrade) => {
      if (!queue) return
      const queued = queue[index]
      if (!queued) return
      const cur = library.items.find((it) => it.id === queued.id) ?? queued
      const nextLibrary = reviewItem(library, cur.id, g)
      persist(nextLibrary)
      if (cur.reviewState.repetitions === 0 && !bumpedRef.current.has(cur.id)) {
        bumpedRef.current.add(cur.id)
        onBumpNewToday()
      }
      const nextState = nextLibrary.items.find((it) => it.id === cur.id)?.reviewState
      if (nextState) {
        const label: Record<ReviewGrade, string> = { again: '忘记了', hard: '模糊', good: '认识', easy: '认识' }
        setGradeInfo(`${label[g]} · 下次复习：${fmtInterval(nextState.interval)}`)
        window.setTimeout(() => setGradeInfo(''), 1600)
      }
      addStudyTime(0, 1)
      markStudied(cur.id)
      recordActivity('vocab', 1)
      setCounts((c) =>
        g === 'again' ? { ...c, forgot: c.forgot + 1 } : g === 'hard' ? { ...c, fuzzy: c.fuzzy + 1 } : { ...c, know: c.know + 1 },
      )
      if (g === 'again' && !forgotRef.current.includes(cur.id)) {
        forgotRef.current.push(cur.id)
        setForgotCount(forgotRef.current.length)
      }
      // 帮记忆：忘记 / 模糊的词本轮末尾再出现一次（各有上限，避免死循环）
      if (g === 'again' || g === 'hard') {
        const used = requeueRef.current.get(cur.id) ?? 0
        const cap = g === 'again' ? 2 : 1
        if (used < cap) {
          requeueRef.current.set(cur.id, used + 1)
          setQueue((q) => (q ? [...q, cur] : q))
        }
      }
      setRevealed(false)
      setInput('')
      setChecked(false)
      setEditOpen(false)
      setDelArmed(false)
      setIndex((i) => i + 1)
    },
    [queue, index, library, persist, onBumpNewToday, addStudyTime, markStudied, recordActivity],
  )

  const close = useCallback(() => setQueue(null), [])

  /** 打开卡内编辑，带出当前值。 */
  const openEdit = useCallback(() => {
    if (!card) return
    setDraft({
      word: card.word,
      phonetic: card.phonetic ?? '',
      partOfSpeech: card.partOfSpeech ?? '',
      meaning: card.meaning ?? '',
      usage: card.usage.join('；'),
    })
    setEditOpen(true)
    setDelArmed(false)
  }, [card])

  /** 保存卡内编辑（持久化；状态置 edited，之后查词不会再覆盖）。 */
  const saveEdit = useCallback(() => {
    if (!card || !draft) return
    const usage = draft.usage
      .split(/[;；\n]/)
      .map((s) => s.trim())
      .filter(Boolean)
    persist(
      editItem(library, card.id, {
        word: draft.word.trim() || card.word,
        phonetic: draft.phonetic.trim() || null,
        partOfSpeech: draft.partOfSpeech.trim() || null,
        meaning: draft.meaning.trim() || null,
        usage,
      }),
    )
    setEditOpen(false)
    setDraft(null)
    flash('已保存修改')
  }, [card, draft, library, persist, flash])

  /** 卡内删除（两步确认），并从本轮队列里移除。 */
  const removeCard = useCallback(() => {
    if (!card) return
    if (!delArmed) {
      setDelArmed(true)
      window.setTimeout(() => setDelArmed(false), 3000)
      return
    }
    persist(removeItem(library, card.id))
    const removedBefore = queue ? queue.slice(0, index).filter((it) => it.id === card.id).length : 0
    setQueue((q) => (q ? q.filter((it) => it.id !== card.id) : q))
    setIndex((i) => Math.max(0, i - removedBefore))
    setDelArmed(false)
    setEditOpen(false)
    setRevealed(false)
    setInput('')
    setChecked(false)
    flash('已删除')
  }, [card, delArmed, library, persist, queue, index, flash])

  /** 收尾重练本轮点过「忘记了」的词。 */
  const retryForgot = useCallback(() => {
    const ids = new Set(forgotRef.current)
    const items = library.items.filter((it) => ids.has(it.id))
    if (!items.length) return
    requeueRef.current = new Map()
    forgotRef.current = []
    bumpedRef.current = new Set()
    setForgotCount(0)
    setCounts({ know: 0, fuzzy: 0, forgot: 0 })
    setQueue(items)
    setIndex(0)
    setRevealed(false)
    setInput('')
    setChecked(false)
    setEditOpen(false)
    setDelArmed(false)
  }, [library.items])

  // 单卡计时：换卡归零，每秒 +1（催你快点，别墨迹）
  useEffect(() => {
    if (!queue) return
    setCardSeconds(0)
    const id = window.setInterval(() => setCardSeconds((s) => s + 1), 1000)
    return () => window.clearInterval(id)
  }, [queue, index])

  // 本轮总时长：进场清零，每秒 +1；每 15s 落盘一次，退出时补落盘
  useEffect(() => {
    if (!queue) return
    liveRef.current = 0
    flushedRef.current = 0
    setLive(0)
    const id = window.setInterval(() => {
      liveRef.current += 1
      setLive(liveRef.current)
      const unflushed = liveRef.current - flushedRef.current
      if (unflushed >= 15) {
        addStudyTime(unflushed, 0)
        flushedRef.current = liveRef.current
      }
    }, 1000)
    return () => {
      window.clearInterval(id)
      const unflushed = liveRef.current - flushedRef.current
      if (unflushed > 0) {
        addStudyTime(unflushed, 0)
        flushedRef.current = liveRef.current
      }
    }
  }, [queue, addStudyTime])

  // 快捷键：空格/回车 翻面/判卷/认识，1/2/3 = 认识/模糊/忘记了，Esc 退出
  useEffect(() => {
    if (!queue || editOpen) return
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null
      const inField = !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)
      const canGrade = spelling ? checked : revealed
      const gradeKeys: Record<string, ReviewGrade> = { '1': 'good', '2': 'hard', '3': 'again' }
      // 拼写模式下输入框还 focus 着；判卷后仍要能用 1/2/3 评分
      if (inField) {
        if (canGrade && gradeKeys[e.key]) {
          e.preventDefault()
          grade(gradeKeys[e.key])
        }
        return
      }
      if (e.key === ' ' || e.key === 'Enter') {
        e.preventDefault()
        if (index >= queue.length) return
        if (!canGrade) {
          if (spelling) setChecked(true)
          else setRevealed(true)
          return
        }
        grade('good')
      } else if (gradeKeys[e.key]) {
        if (canGrade) grade(gradeKeys[e.key])
      } else if (e.key === 'Escape') close()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [queue, editOpen, index, revealed, spelling, checked, grade, close])

  return {
    scope,
    setScope,
    spelling,
    setSpelling,
    mode,
    setMode,
    queue,
    index,
    revealed,
    setRevealed,
    input,
    setInput,
    checked,
    setChecked,
    editOpen,
    setEditOpen,
    counts,
    liveSeconds: live,
    cardSeconds,
    gradeInfo,
    pool,
    draft,
    setDraft,
    delArmed,
    forgotCount,
    card,
    dueCount,
    newCount,
    /** 本轮尚未落盘的秒数（用于「累计时长」显示）。 */
    unflushedSeconds: Math.max(0, live - flushedRef.current),
    start,
    switchMode,
    switchScope,
    startArticleAll,
    grade,
    close,
    retryForgot,
    openEdit,
    saveEdit,
    removeCard,
  }
}
