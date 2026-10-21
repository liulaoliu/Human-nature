import { useCallback, useRef, useState } from 'react'
import { useHotkeys } from '../useHotkeys'
import { inStudyDeck, type StudyDeck } from '../../core/entryKind'
import {
  buildLearnQueue,
  buildReviewQueue,
  canQuizMeaning,
  MAX_CARD_APPEARANCES,
  needsMeaningCheck,
  planExtra,
  planRetryForgot,
  reviewItem,
  sortItems,
  beginExtraRound,
  emptyExtraRound,
  type ExtraRound,
  type ReviewGrade,
  type StudyMode,
} from '../../core/vocab'
import type { VocabItem, VocabLibrary } from '../../types/document'
import type { ActivityCat } from '../../core/activity'
import { fmtInterval } from '../format'
import { useStudyCardEdit } from './useStudyCardEdit'
import { useStudyPool, type StudyScope } from './useStudyPool'
import { useStudyTimers } from './useStudyTimers'

export type { StudyScope }

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
  /** 朗读单词（与卡片右侧 🔊 同一个入口）。 */
  speak: (text: string) => void
  /** 每天最多引入多少新词（0=不限）与今天已引入数。 */
  newLimit: number
  newToday: number
  onBumpNewToday: () => void
}

/**
 * 背单词会话：模式/范围/队列/评分（SRS）/错题重排/每日新词配额/卡内编辑删除/计时/快捷键。
 *
 * 评分：认识→good、模糊→hard、忘记了→again；忘记/模糊的词本轮末尾再出现（加练），
 * 但每张卡每轮最多出场 3 次（账本在 `core/vocab/extra`），到上限只写排期、不再追加。
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
    speak,
    newLimit,
    newToday,
    onBumpNewToday,
  } = params

  /** 范围 / 牌组 / 新学或复习 / 拼写 / 锤炼阈值 + 候选池。 */
  const {
    scope,
    setScope,
    spelling,
    setSpelling,
    drillAfter,
    setDrillAfter,
    mode,
    setMode,
    deck,
    setDeck,
    pool,
    poolFor,
    dueCount,
    newCount,
  } = useStudyPool({ library, articleIdentity, docLemmas })

  const [queue, setQueue] = useState<VocabItem[] | null>(null)
  const [index, setIndex] = useState(0)
  const [revealed, setRevealed] = useState(false)
  const [input, setInput] = useState('')
  const [checked, setChecked] = useState(false)
  const [counts, setCounts] = useState({ know: 0, fuzzy: 0, forgot: 0 })
  const [gradeInfo, setGradeInfo] = useState('')
  /** 本轮加练 / 重练的出场账本（每卡最多出场 3 次，跨重练保留）。 */
  const [extraRound, setExtraRound] = useState<ExtraRound>(emptyExtraRound)
  /** 本轮点过「忘记了」的词 id，用于收尾重练 */
  const forgotRef = useRef<string[]>([])
  /** 本轮已计入每日新词配额的 id（重排后不重复计数） */
  const bumpedRef = useRef<Set<string>>(new Set())
  /** 供外部（收尾小结）显示「重练忘记的 N 个」 */
  const [forgotCount, setForgotCount] = useState(0)
  /** 本轮总数（进度分母）——开始时冻结；忘记/模糊只加练，不撑大它。 */
  const [roundTotal, setRoundTotal] = useState(0)
  /** 忘记/模糊触发的「加练」次数（单独计数，不计入分母）。 */
  const [extraCount, setExtraCount] = useState(0)
  /** 收尾「重练忘记的」：也按加练处理，标过不认识的词要先选释义。 */
  const [retrying, setRetrying] = useState(false)
  /** 本卡是否已经通过「选中文释义」这一关（换卡/评分时重置）。 */
  const [meaningCleared, setMeaningCleared] = useState(false)
  /** 本卡是否已完成「强制锤炼」（完成才允许评分） */
  const [drillCleared, setDrillCleared] = useState(false)

  /** 当前卡：优先取词库最新（评分/编辑后立刻反映），队列快照兜底。 */
  const card =
    queue && index < queue.length ? (library.items.find((it) => it.id === queue[index].id) ?? queue[index]) : null
  /** 本轮加练（忘记/模糊后被追加到队尾）的卡；收尾重练另有 retrying 标记。 */
  const isExtraCard = !!queue && roundTotal > 0 && index >= roundTotal
  /** 标过「不认识」的词，在复习 / 加练时要先选中文释义（规则在 core）。 */
  const meaningRequired =
    !!card && needsMeaningCheck(card, { extra: isExtraCard, retrying }) && canQuizMeaning(card, library.items)
  const meaningGate = meaningRequired && !meaningCleared

  const clearMeaningGate = useCallback(() => setMeaningCleared(true), [])

  /** 卡内编辑 / 两步删除（队列与进度仍由本 hook 推进）。 */
  const {
    editOpen,
    setEditOpen,
    draft,
    setDraft,
    delArmed,
    setDelArmed,
    openEdit,
    saveEdit,
    removeCard,
  } = useStudyCardEdit({
    card,
    library,
    queue,
    index,
    persist,
    flash,
    setQueue,
    setRoundTotal,
    setIndex,
    setRevealed,
    setInput,
    setChecked,
  })

  /**
   * 单卡计时 + 本轮总时长（每 15s / 暂停 / 退出时落盘）。
   * 卡内编辑时两只表都暂停：改词形/释义的时间不算学习时长，也不推进锤炼阈值。
   */
  const { liveSeconds, cardSeconds, unflushedSeconds } = useStudyTimers({
    queue,
    index,
    addStudyTime,
    paused: editOpen,
  })

  /** 本卡是否处于「强制锤炼」（超时且还没锤炼过）。 */
  const drillOn = !!queue && !!card && drillAfter > 0 && cardSeconds >= drillAfter && !drillCleared
  const clearDrill = useCallback(() => {
    setDrillCleared(true)
    // 锤炼里已经考过「选词义」；不再让同一张卡接着做一遍复习门禁。
    setMeaningCleared(true)
  }, [])

  /** 换卡时重置卡片 UI 状态。 */
  const resetCardUi = useCallback(() => {
    setRevealed(false)
    setInput('')
    setChecked(false)
    setEditOpen(false)
    setDraft(null)
    setDelArmed(false)
    setDrillCleared(false)
    setMeaningCleared(false)
  }, [])

  const resetSession = useCallback(() => {
    setExtraRound(emptyExtraRound())
    forgotRef.current = []
    bumpedRef.current = new Set()
    setForgotCount(0)
    setExtraCount(0)
    setRetrying(false)
    setCounts({ know: 0, fuzzy: 0, forgot: 0 })
    resetCardUi()
  }, [resetCardUi])

  /** 开始背单词/背搭配：按模式组队（新学习 = 没学过的；复习 = 已学过且到期的）。 */
  const start = useCallback(
    (opts?: { mode?: StudyMode; scope?: StudyScope; deck?: StudyDeck }) => {
      const nextMode = opts?.mode ?? mode
      const nextScope = opts?.scope ?? scope
      const nextDeck = opts?.deck ?? deck
      if (opts?.mode != null) setMode(nextMode)
      if (opts?.scope != null) setScope(nextScope)
      if (opts?.deck != null) setDeck(nextDeck)
      const p = poolFor(nextScope, nextDeck)
      const q =
        nextMode === 'review'
          ? buildReviewQueue(p, new Date())
          : buildLearnQueue(p, new Date(), { newLimit, newToday })
      if (!q.length) {
        const thing = nextDeck === 'collocation' ? '搭配' : '词'
        flash(
          nextMode === 'review'
            ? nextScope === 'article'
              ? `这篇没有到期的复习${thing}`
              : `没有到期的复习${thing}，去「新学习」吧`
            : nextScope === 'article'
              ? `这篇没有待学的新${thing}`
              : `没有待学的新${thing}，去「复习」吧`,
        )
        // 换牌组后旧队列已经不对应当前牌组，直接收起，避免界面显示错位的卡
        if (opts?.deck != null && nextDeck !== deck) setQueue(null)
        return
      }
      closeQuiz()
      resetSession()
      setQueue(q)
      setExtraRound(beginExtraRound(q.map((it) => it.id)))
      setRoundTotal(q.length)
      setIndex(0)
    },
    [poolFor, mode, scope, deck, newLimit, newToday, flash, closeQuiz, resetSession, setMode, setScope, setDeck],
  )

  const switchMode = useCallback((m: StudyMode) => start({ mode: m }), [start])
  const switchScope = useCallback((s: StudyScope) => start({ scope: s }), [start])
  const switchDeck = useCallback(
    (d: StudyDeck) => {
      if (d === deck) return
      if (!library.items.some((it) => inStudyDeck(it, d))) {
        flash(d === 'collocation' ? '还没有词组/习语：先在阅读里收藏语言点' : '还没有可背的单词')
        return
      }
      start({ deck: d })
    },
    [deck, library.items, flash, start],
  )

  /** 「本篇全部」：把这篇文章的生词整套过一遍（不分新学/复习、忽略新词配额）。 */
  const startArticleAll = useCallback(() => {
    const p = poolFor('article')
    if (!p.length) {
      flash(deck === 'collocation' ? '这篇还没有搭配' : '这篇还没有生词')
      return
    }
    setScope('article')
    closeQuiz()
    resetSession()
    const all = sortItems(p, 'due')
    setQueue(all)
    setExtraRound(beginExtraRound(all.map((it) => it.id)))
    setRoundTotal(all.length)
    setIndex(0)
  }, [poolFor, deck, flash, closeQuiz, resetSession, setScope])

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
      // 帮记忆：忘记 / 模糊的词本轮末尾再加练（规则在 core/vocab/extra：
      // 每卡每轮最多出场 3 次、跨「重练忘记的」保留、过了释义门禁就不再追加）
      if (g === 'again' || g === 'hard') {
        const decision = planExtra(extraRound, cur.id, g, { gated: meaningRequired })
        if (decision.append) {
          setExtraRound(decision.round)
          setQueue((q) => (q ? [...q, cur] : q))
          setExtraCount((n) => n + 1)
        } else if (decision.blocked === 'cap') {
          flash(`本轮已练 ${MAX_CARD_APPEARANCES} 次，按当前评分排期`)
        } else if (decision.blocked === 'gate') {
          flash('已过释义关，这张卡按当前评分排期')
        }
      }
      setRevealed(false)
      setInput('')
      setChecked(false)
      setEditOpen(false)
      setDelArmed(false)
      setDrillCleared(false)
      setMeaningCleared(false)
      setIndex((i) => i + 1)
    },
    [queue, index, library, persist, onBumpNewToday, addStudyTime, markStudied, recordActivity, extraRound, meaningRequired, flash],
  )

  const close = useCallback(() => setQueue(null), [])

  /** 回滚到上一个单词（不撤销已评分，只回看/再练）。 */
  const back = useCallback(() => {
    if (!queue || index <= 0) return
    resetCardUi()
    setIndex((i) => Math.max(0, i - 1))
  }, [queue, index, resetCardUi])

  /** 切到下一个单词（不评分，只切换）。 */
  const forward = useCallback(() => {
    if (!queue || index >= queue.length) return
    resetCardUi()
    setIndex((i) => i + 1)
  }, [queue, index, resetCardUi])

  /** 「不认识」：安排复习（按「忘记」重置，比模糊更狠）+ 打标签；**本轮不重排**，不增加本轮总数。 */
  const markUnknown = useCallback(() => {
    if (!queue) return
    const queued = queue[index]
    if (!queued) return
    const cur = library.items.find((it) => it.id === queued.id) ?? queued
    const reviewed = reviewItem(library, cur.id, 'again')
    persist({
      ...reviewed,
      items: reviewed.items.map((it) =>
        it.id === cur.id && !it.tags.includes('不认识') ? { ...it, tags: [...it.tags, '不认识'] } : it,
      ),
    })
    if (!forgotRef.current.includes(cur.id)) {
      forgotRef.current.push(cur.id)
      setForgotCount(forgotRef.current.length)
    }
    setCounts((c) => ({ ...c, forgot: c.forgot + 1 }))
    addStudyTime(0, 1)
    markStudied(cur.id)
    recordActivity('vocab', 1)
    setGradeInfo('已标为「不认识」· 已安排复习')
    window.setTimeout(() => setGradeInfo(''), 1600)
    flash('已标为「不认识」的全新词，已安排复习')
    resetCardUi()
    setIndex((i) => i + 1)
  }, [queue, index, library, persist, addStudyTime, markStudied, recordActivity, flash, resetCardUi])

  /** 收尾重练本轮点过「忘记了」的词（每轮只发起一次，已练满 3 次的不再进队）。 */
  const retryForgot = useCallback(() => {
    const ids = new Set(forgotRef.current)
    const items = library.items.filter((it) => ids.has(it.id))
    if (!items.length) return
    const plan = planRetryForgot(extraRound, items.map((it) => it.id))
    if (plan.blocked) {
      flash('本轮已经重练过忘记的词了')
      return
    }
    setExtraRound(plan.round)
    if (!plan.ids.length) {
      flash(`这些词本轮已练满 ${MAX_CARD_APPEARANCES} 次，按当前评分排期`)
      return
    }
    if (plan.capped > 0) flash(`${plan.capped} 个词本轮已练满 ${MAX_CARD_APPEARANCES} 次，不再重练`)
    const keep = new Set(plan.ids)
    const retryItems = items.filter((it) => keep.has(it.id))
    forgotRef.current = []
    bumpedRef.current = new Set()
    setForgotCount(0)
    setExtraCount(0)
    setCounts({ know: 0, fuzzy: 0, forgot: 0 })
    setQueue(retryItems)
    setRoundTotal(retryItems.length)
    setRetrying(true)
    setIndex(0)
    resetCardUi()
  }, [library.items, extraRound, flash, resetCardUi])

  // 快捷键：空格/回车 翻面/判卷/认识，1/2/3 = 认识/模糊/忘记了，Q/E = 上一个/下一个单词，Esc 退出
  useHotkeys(
    (e) => {
      if (!queue || editOpen || drillOn) return
      if (e.ctrlKey || e.metaKey || e.altKey) return
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
      const key = e.key.toLowerCase()
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
      } else if (key === 'r') {
        const cur = queue[index]
        // 拼写模式判卷前读出来就剧透了（自动朗读也为此关掉）
        if (!cur || (spelling && !checked)) return
        e.preventDefault()
        if (!e.repeat) speak(cur.word)
      } else if (key === 'q') {
        e.preventDefault()
        back()
      } else if (key === 'e') {
        e.preventDefault()
        forward()
      } else if (e.key === 'Escape') close()
    },
    !!queue && !editOpen && !drillOn && !meaningGate,
    40,
  )

  return {
    scope,
    setScope,
    spelling,
    setSpelling,
    mode,
    setMode,
    deck,
    switchDeck,
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
    liveSeconds,
    cardSeconds,
    gradeInfo,
    pool,
    draft,
    setDraft,
    delArmed,
    forgotCount,
    /** 本轮还能不能点「重练忘记的」（每轮只发起一次）。 */
    canRetryForgot: !extraRound.retried,
    roundTotal,
    extraCount,
    card,
    dueCount,
    newCount,
    drillOn,
    meaningGate,
    drillAfter,
    setDrillAfter,
    clearDrill,
    clearMeaningGate,
    /** 本轮尚未落盘的秒数（用于「累计时长」显示）。 */
    unflushedSeconds,
    start,
    switchMode,
    switchScope,
    startArticleAll,
    grade,
    back,
    forward,
    markUnknown,
    close,
    retryForgot,
    openEdit,
    saveEdit,
    removeCard,
  }
}
