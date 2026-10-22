import { useCallback, useRef, useState } from 'react'
import {
  canQuizMeaning,
  isRelearning,
  needsForgotConfirm,
  needsMeaningCheck,
  planRetryForgot,
  groupEndOf,
  beginExtraRound,
  displayMeaning,
  emptyExtraRound,
  shouldDrill,
  type ExtraRound,
  type ReviewGrade,
} from '../../core/vocab'
import type { VocabItem, VocabLibrary } from '../../types/document'
import type { ActivityCat } from '../../core/activity'
import { useStudyCardEdit } from './useStudyCardEdit'
import { useStudyGrading } from './useStudyGrading'
import { useStudyLearnStep } from './useStudyLearnStep'
import { useStudyPool, type StudyScope } from './useStudyPool'
import { useStudySpellGate } from './useStudySpellGate'
import { useStudyReviewStep } from './useStudyReviewStep'
import { useStudyHotkeys } from './useStudyHotkeys'
import { useStudyStarts } from './useStudyStarts'
import { useStudySpellingRound } from './useStudySpellingRound'
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
 * 背单词会话：模式/范围/队列/评分（SRS）/重学/错题重排/每日新词配额/卡内编辑删除/计时/快捷键。
 *
 * 评分：认识→good、模糊→hard、忘记了→again。again 会把词打进「重学」：
 * 本轮末尾再出现（每卡每轮最多 3 次，账本在 `core/vocab/extra`），下次从「看词」开始、
 * 揭示后强制锤炼；SRS 走 1 天 → 3 天阶梯，连续两次答对才退出重学。
 *
 * 拼写：错一次即判「不认识」（`checkSpelling` / `applySpellingMiss`），不提供第二次输入，
 * 确认前锁住切卡与退出。
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
    /** 学习模式每组多少词（0 = 跟随范围：本篇 = 全部；其它 = 20）。 */
    groupSize,
    setGroupSize,
    mode,
    setMode,
    deck,
    setDeck,
    effectiveGroupSize,
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
  /** 本轮加练 / 重练的出场账本（每卡最多出场 3 次，跨重练保留）。 */
  const [extraRound, setExtraRound] = useState<ExtraRound>(emptyExtraRound)
  /** 本轮总数（进度分母）——开始时冻结；忘记/模糊只加练，不撑大它。 */
  const [roundTotal, setRoundTotal] = useState(0)

  /**
   * 判定落库与记账：评分 / 拼错 / 标「不认识」/ 组末拼错共用一套账本
   * （写库 → 今日新词 → 计时与活动 → 计数 → 重排 → 提示），见 `useStudyGrading`。
   */
  const grading = useStudyGrading({
    library,
    extraRound,
    setExtraRound,
    setQueue,
    persist,
    markStudied,
    recordActivity,
    addStudyTime,
    flash,
    onBumpNewToday,
  })
  /** 收尾「重练忘记的」：也按加练处理，标过不认识的词要先选释义。 */
  const [retrying, setRetrying] = useState(false)
  /** 本卡是否已经通过「选中文释义」这一关（换卡/评分时重置）。 */
  const [meaningCleared, setMeaningCleared] = useState(false)
  /** 本卡是否已完成「强制锤炼」（完成才允许评分） */
  const [drillCleared, setDrillCleared] = useState(false)
  /** 本卡刚过释义关却点了「忘记了」：等用户确认按哪个排期（不偷偷改分）。 */
  const [pendingForgot, setPendingForgot] = useState(false)
  /**
   * 学习模式「4 条释义」那一关的状态（做题 / 揭示 / 等待下一词）。
   * 定义在 `resetCardUi` 之后也没关系：换卡时通过这个 ref 调它的 `reset`。
   */
  const learnResetRef = useRef<() => void>(() => {})
  /** `spellGate` 定义在 `resetCardUi` 之后（要用到 `card`）；换卡时经这个 ref 清判错卡。 */
  const spellGateResetRef = useRef<() => void>(() => {})
  /** 复习模式三键的待定 / 已判状态；换卡时经这个 ref 清掉。 */
  const reviewResetRef = useRef<() => void>(() => {})
  /**
   * 组末拼写测试（学习模式每组结束）：本组全部词挨个拼一遍。
   * 触发与推进由主 hook 管（`forward` 到组末就 `begin`），词的状态机在子 hook 里。
   */
  const spellingRound = useStudySpellingRound({
    onMiss: (item) => {
      // 判定在这里已经定了（again + relearn + 「不认识」标签）；组末是验收，不再本轮重排
      grading.recordRoundTestMiss(item)
      flash(`「${item.word}」拼错了，已判为「不认识」`)
    },
    onDone: () => finishGroupRef.current?.(),
  })
  /** 正在拼写测试的这一组的组末下标（拼完把 index 推到这里）。 */
  const pendingGroupEndRef = useRef<number | null>(null)
  /** 当前组在队列里的起点（组完成时前移；重开一轮归零）。 */
  const groupCursorRef = useRef(0)
  /** `finishGroup` 定义在下面（要用到 `resetCardUi`）；这里存引用给 `spellingRound.onDone` 用。 */
  const finishGroupRef = useRef<(() => void) | null>(null)

  /** 当前卡：优先取词库最新（评分/编辑后立刻反映），队列快照兜底；组末拼写测试时换测试里的词。 */
  const card = spellingRound.card
    ? spellingRound.card
    : queue && index < queue.length
      ? (library.items.find((it) => it.id === queue[index].id) ?? queue[index])
      : null
  /** 本轮加练（忘记/模糊后被追加到队尾）的卡；收尾重练另有 retrying 标记。 */
  const isExtraCard = !!queue && roundTotal > 0 && index >= roundTotal
  /**
   * 正在重学的词（拼错 / 记住过又忘）：从「看词」开始，而不是直接进拼写题；
   * 揭示释义后强制走一遍锤炼（拼写 + 选义 + 搭配），过了才允许评分。
   */
  const relearning = !!card && isRelearning(card)
  /** 标过「不认识」的词，在复习 / 加练时要先选中文释义（规则在 core）。 */
  const meaningRequired =
    !!card && !relearning && needsMeaningCheck(card, { extra: isExtraCard, retrying }) && canQuizMeaning(card, library.items)
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
    setPendingForgot(false)
    spellGateResetRef.current()
    learnResetRef.current()
    reviewResetRef.current()
  }, [])

  const resetSession = useCallback(() => {
    setExtraRound(emptyExtraRound())
    grading.resetLedger()
    setRetrying(false)
    groupCursorRef.current = 0
    finishGroupRef.current = null
    spellingRound.reset()
    resetCardUi()
  }, [resetCardUi, spellingRound, grading.resetLedger])

  /**
   * 推进到下一张卡：到了「每组 N 词」的组末先停下把本组全部词拼一遍，
   * 拼完才由 `finishGroup` 把指针推到组末（Spec 2026-10-22：学多少拼多少）。
   *
   * 两种模式共用：学习模式判完点「下一词」、复习模式评「认识」都会走到这里。
   * 加练 / 重练排在 `roundTotal` 之后的卡不触发组末（它们不是这一组的新内容）。
   */
  const advanceFrom = useCallback(
    (from: number) => {
      if (!queue) return
      if (from < roundTotal) {
        const end = groupEndOf(from, roundTotal, effectiveGroupSize)
        if (from + 1 >= end) {
          pendingGroupEndRef.current = end
          spellingRound.begin(queue.slice(groupCursorRef.current, end))
          return
        }
      }
      resetCardUi()
      setIndex(from + 1)
    },
    [queue, roundTotal, effectiveGroupSize, spellingRound, resetCardUi],
  )

  /**
   * 拼写判定的落库与记账（判错卡的状态机在 `hooks/useStudySpellGate`）。
   * 不做「再试一次」：拼写是硬门槛，允许反复输入等于把判断变成抄写。
   *
   * - 立刻按「忘记」写 SRS（`relearn` +1，进入重学）并打「不认识」标签；
   * - 本轮把它重排到队尾（仍受每卡 3 次上限约束），揭示释义后强制走完整锤炼（拼写 → 选义 → 搭配）；
   * - 在用户确认前锁住切卡 / 退出，避免拼错后直接略过。
   */
  const spellGate = useStudySpellGate({
    active: !!queue && !!card,
    card,
    judge: (typed: string) => {
      const cur = card
      if (!cur || !queue) return { requeued: false, word: typed, meaning: null }
      // 写库 + 记账 + 本轮重排，都在 grading 里（和正常评分同一本账）
      const requeued = grading.recordSpellingMiss(cur)
      grading.showGradeInfo('拼写错误 · 判为不认识 · 已从零重学', 2000)
      flash('拼写错误，已判为「不认识」：这个词会从零重学')
      setChecked(true)
      setRevealed(false)
      return { requeued, word: cur.word, meaning: displayMeaning(cur) || null }
    },
  })
  const { spellMiss } = spellGate
  spellGateResetRef.current = spellGate.reset

  /** 确认拼写判错，进入下一张卡（这个词已重排在队尾）。 */
  const ackSpellMiss = useCallback(() => {
    if (!spellMiss) return
    spellGate.ack()
    resetCardUi()
    setIndex((i) => i + 1)
  }, [spellMiss, spellGate, resetCardUi])

  /** 拼写模式的「检查」：对 → 解锁评分；错 → 立即判不认识（不提供第二次输入）。 */
  const checkSpelling = useCallback(() => {
    if (!queue || !card || checked) return
    setChecked(true)
    spellGate.check(input)
  }, [queue, card, checked, input, spellGate])

  /** 锤炼板拼写步的拼错回调：与正面拼写同一条判定与落库路径。 */
  const applySpellingMiss = useCallback((typed: string) => spellGate.check(typed), [spellGate])

  /**
   * 装一轮队列：重置账本 → 队列 → 分母（本轮总数，开始时冻结）→ 指针归零。
   * 「背哪些词」的决定在 `useStudyStarts`，这里只负责装进会话。
   */
  const load = useCallback(
    (items: VocabItem[], opts?: { retrying?: boolean }) => {
      resetSession()
      setQueue(items)
      setExtraRound(beginExtraRound(items.map((it) => it.id)))
      setRoundTotal(items.length)
      setRetrying(!!opts?.retrying)
      setIndex(0)
    },
    [resetSession],
  )

  /** 开一轮 / 换模式 / 换范围 / 换牌组：「背哪些词」的规则在 `useStudyStarts`。 */
  const { start, switchMode, switchScope, switchDeck, startArticleAll, startRelearn } = useStudyStarts({
    library,
    poolFor,
    mode,
    scope,
    deck,
    setMode,
    setScope,
    setDeck,
    newLimit,
    newToday,
    flash,
    closeQuiz,
    blocked: !!spellMiss,
    load,
    clear: () => setQueue(null),
  })

  /**
   * 真正落库的评分（对外入口是下面的 `grade`，会先处理「忘记确认」）。
   * 账本（写库 / 今日新词 / 计时 / 计数 / 重排 / 提示）在 `grading.recordGrade`；
   * 这里只负责「清卡片 UI」和「要不要推进」。
   *
   * `opts.advance = false`：只写库不跳下一张（学习模式判完要停在单词卡等「下一词」）。
   * `opts.learnPass`：学习模式里把「这次有没有没看答案就选对」一起写进
   * `ReviewState.meaningPasses`——两次 persist 会互相覆盖，所以必须一次算完。
   */
  const applyGrade = useCallback(
    (g: ReviewGrade, opts?: { advance?: boolean; learnPass?: boolean }) => {
      if (spellMiss || spellingRound.test) return
      if (!queue) return
      const queued = queue[index]
      if (!queued) return
      grading.recordGrade(g, queued, opts?.learnPass)
      setRevealed(false)
      setInput('')
      setChecked(false)
      setEditOpen(false)
      setDelArmed(false)
      setDrillCleared(false)
      setMeaningCleared(false)
      setPendingForgot(false)
      if (opts?.advance !== false) {
        // 复习模式「认识」直接推进：组末拼写挂在这条路上；
        // 学习模式判完不推进（advance:false），组末由「下一词 / E」的 forward 触发。
        if (mode === 'review') advanceFrom(index)
        else setIndex((i) => i + 1)
      }
    },
    [queue, index, grading.recordGrade, spellMiss, spellingRound.test, mode, advanceFrom],
  )

  /**
   * 学习模式「4 条中文释义」这一关：做题 → 判定 → 揭示停留 → 进单词卡 → 等「下一词」。
   *
   * 判定规则在 `core/vocab/learnStep`，卡片状态机在 `hooks/useStudyLearnStep`；
   * 这里只负责把它接上：落库仍走 `applyGrade`（`advance: false`——判完要停在单词卡，
   * 由用户点「下一词」才推进，见 Spec）。
   */
  const learn = useStudyLearnStep({
    mode,
    card,
    items: library.items,
    active: !!queue && !!card,
    judge: (g, learnPass) => applyGrade(g, { advance: false, learnPass }),
    showCard: () => setRevealed(true),
  })
  learnResetRef.current = learn.reset

  const { learnPhase, learnReveal, learnGraded } = learn

  /** 卡停超时（本轮这一卡还没锤炼过）。「该不该真锤炼」还要看是不是已经判完停着，见下面的 `drillOn`。 */
  const drillTimedOut = drillAfter > 0 && cardSeconds >= drillAfter && !drillCleared

  /**
   * 评分入口：这张卡刚选对释义（释义关 / 锤炼里的选义题）却点「忘记了」，
   * 说明两个信号矛盾，先拦成一次显式确认；确认后仍按用户原意写 again，不偷改分。
   */
  const grade = useCallback(
    (g: ReviewGrade) => {
      if (needsForgotConfirm({ grade: g, meaningProven: meaningCleared })) {
        setPendingForgot(true)
        return
      }
      applyGrade(g)
    },
    [applyGrade, meaningCleared],
  )

  /** 确认「确实忘了」：按 again 落库（repetitions 归零、进入重学）。 */
  const confirmForgot = useCallback(() => {
    setPendingForgot(false)
    applyGrade('again')
  }, [applyGrade])

  /** 改按「模糊」：刚选对释义，多半只是没把握，不必把进度清零。 */
  const softenForgot = useCallback(() => {
    setPendingForgot(false)
    applyGrade('hard')
  }, [applyGrade])

  const cancelForgot = useCallback(() => setPendingForgot(false), [])

  /**
   * 复习模式「只显示单词 + 三键」（Spec 2026-10-22）。
   *
   * 认识直接换下一张（组末拼写核验）；模糊先不写库、摊卡等「下一词 / 记错了」；
   * 忘记立刻判不认识并停卡。重学卡 / 释义门禁 / 锤炼进行中不抢这条路。
   *
   * 拼写模式开着时，判卷前输入框还在用：`!(spelling && !checked)` 把这一小段让给输入框。
   */
  const reviewStep = useStudyReviewStep({
    mode,
    active: !!queue && !!card,
    ready: !relearning && !meaningGate && !drillTimedOut && !learnPhase && !spellMiss && !(spelling && !checked),
    judge: (g, advance) => {
      if (needsForgotConfirm({ grade: g, meaningProven: meaningCleared })) {
        setPendingForgot(true)
        return
      }
      applyGrade(g, { advance })
    },
    showCard: () => setRevealed(true),
  })
  reviewResetRef.current = reviewStep.reset

  /**
   * 本卡是否处于「强制锤炼」（超时 / 重学卡揭示释义后）。
   *
   * 规则在 `core/vocab/drill`：**已经判完停着等「下一词」的卡不锤炼**——
   * 打分都落库了，再考一次也解锁不了什么，但会把「看一眼单词卡」顶掉
   * （选错释义 → 判 again → 这词立刻进重学，点「继续」就会撞上重学分支）。
   */
  const drillOn = shouldDrill({
    active: !!queue && !!card,
    spellMiss: !!spellMiss,
    learnPhase,
    parked: learnGraded || reviewStep.graded || reviewStep.fuzzy,
    timedOut: drillTimedOut,
    relearnRevealed: relearning && revealed,
  })

  /** 面板「认识 / 模糊 / 忘记了」按钮的入口：复习模式走三键状态机，其它模式走原来的评分。 */
  const pressGrade = useCallback(
    (g: ReviewGrade) => (mode === 'review' ? reviewStep.answer(g) : grade(g)),
    [mode, reviewStep, grade],
  )

  const close = useCallback(() => {
    // 拼错后必须先确认「判为不认识」，不给直接退出把这次判罚吞掉
    if (spellMiss) {
      flash('拼错了：先确认「从头重学」，再退出')
      return
    }
    setQueue(null)
  }, [spellMiss, flash])

  /** 回滚到上一个单词（不撤销已评分，只回看/再练）。 */
  const back = useCallback(() => {
    if (spellMiss) return
    if (!queue || index <= 0) return
    resetCardUi()
    setIndex((i) => Math.max(0, i - 1))
  }, [queue, index, resetCardUi, spellMiss])

  /** 切到下一个单词（不评分，只切换）；组末会先做拼写测试。 */
  const forward = useCallback(() => {
    if (spellMiss || spellingRound.test) return
    if (!queue || index >= queue.length) return
    advanceFrom(index)
  }, [queue, index, spellMiss, spellingRound.test, advanceFrom])

  /** 本组拼写全过：把 index 推到组末（下一组的头），若是最后一组就进入本轮小结。 */
  const finishGroup = useCallback(() => {
    const end = pendingGroupEndRef.current
    if (end == null) return
    pendingGroupEndRef.current = null
    groupCursorRef.current = end
    resetCardUi()
    setIndex(end)
  }, [resetCardUi])
  finishGroupRef.current = finishGroup

  /** 标「不认识」：安排复习（按「忘记」重置，比模糊更狠）+ 打标签；**本轮不重排**，不增加本轮总数。 */
  const markUnknown = useCallback(() => {
    if (!queue) return
    const queued = queue[index]
    if (!queued) return
    grading.recordUnknown(queued)
    resetCardUi()
    setIndex((i) => i + 1)
  }, [queue, index, grading.recordUnknown, resetCardUi])

  /** 收尾重练本轮点过「忘记了」的词（每轮只发起一次，已练满 3 次的不再进队）。 */
  const retryForgot = useCallback(() => {
    const ids = new Set(grading.getForgotIds())
    const items = library.items.filter((it) => ids.has(it.id))
    if (!items.length) return
    const plan = planRetryForgot(extraRound, items.map((it) => it.id))
    if (plan.blocked) {
      flash('本轮已经重练过忘记的词了')
      return
    }
    setExtraRound(plan.round)
    if (!plan.ids.length) {
      flash('没有可重练的词')
      return
    }
    const keep = new Set(plan.ids)
    const retryItems = items.filter((it) => keep.has(it.id))
    grading.resetLedger()
    setQueue(retryItems)
    setRoundTotal(retryItems.length)
    setRetrying(true)
    setIndex(0)
    resetCardUi()
  }, [library.items, extraRound, flash, resetCardUi, grading.resetLedger, grading.getForgotIds])

  /** 背单词的键盘映射集中在 `hooks/useStudyHotkeys`（面板按钮上的 kbd 与它一一对应）。 */
  useStudyHotkeys(
    {
      mode,
      index,
      queueLength: queue?.length ?? 0,
      spelling,
      revealed,
      checked,
      editOpen,
      drillOn,
      spellMiss: !!spellMiss,
      pendingForgot,
      meaningGate,
      roundTest: !!spellingRound.test,
      learnPhase,
      learnReveal: !!learnReveal,
      learnGraded,
      reviewFuzzy: reviewStep.fuzzy,
      reviewGraded: reviewStep.graded,
      reviewKeys: reviewStep.keysReady,
      word: card?.word ?? null,
    },
    {
      revealAnswer: learn.revealAnswer,
      continueLearn: learn.continueNow,
      next: forward,
      back,
      close,
      markUnknown,
      speak,
      setRevealed,
      setChecked,
      grade: pressGrade,
      chooseReview: reviewStep.choose,
    },
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
    counts: grading.counts,
    liveSeconds,
    cardSeconds,
    gradeInfo: grading.gradeInfo,
    pool,
    draft,
    setDraft,
    delArmed,
    forgotCount: grading.forgotCount,
    /** 本轮还能不能点「重练忘记的」（每轮只发起一次）。 */
    canRetryForgot: !extraRound.retried,
    roundTotal,
    extraCount: grading.extraCount,
    card,
    /** 组末拼写测试（学习模式每组结束）：非空时整页显示它，`card` 已换成测试里的词。 */
    roundTest: spellingRound.test,
    roundMiss: spellingRound.miss,
    roundInput: spellingRound.input,
    onRoundInputChange: spellingRound.setInput,
    onRoundCheck: spellingRound.check,
    dueCount,
    newCount,
    drillOn,
    meaningGate,
    /** 学习模式：这一卡正在过「4 条中文释义」这一关（判完才进单词卡）。 */
    learnPhase,
    /** 揭示答案后的高亮（正确项 / 选错项；auto = 停留后自动进卡）。 */
    learnReveal,
    /** 学习模式：这一卡已经判过，停在单词卡等「下一词」。 */
    learnGraded,
    /** 复习模式：三键直接可点（看见单词就能判，不用先翻面）。 */
    reviewKeys: reviewStep.keysReady,
    /** 复习模式：模糊待定中，卡片已摊开，等「下一词」/「记错了」。 */
    reviewFuzzy: reviewStep.fuzzy,
    /** 复习模式：已判过并停卡（忘记 / 记错了），等「下一词」。 */
    reviewGraded: reviewStep.graded,
    answerReview: reviewStep.answer,
    chooseReview: reviewStep.choose,
    revealLearnAnswer: learn.revealAnswer,
    answerLearn: learn.answer,
    continueLearn: learn.continueNow,
    /** 当前卡正在重学（拼错 / 记住过又忘）：从「看词」开始，揭示后强制锤炼。 */
    relearning,
    /** 拼写错误的判定提示；非空时禁止切卡 / 退出，必须先确认。 */
    spellMiss,
    /** 刚过释义关却点「忘记了」，等确认（确认前不落库）。 */
    pendingForgot,
    /** 判定提示期间锁住导航（结束 / 上一个 / 下一个）。 */
    navLocked: !!spellMiss || !!spellingRound.test,
    drillAfter,
    setDrillAfter,
    /** 学习模式每组多少词（0 = 跟随范围：本篇 = 全部；其它 = 20）。 */
    groupSize,
    setGroupSize,
    clearDrill,
    clearMeaningGate,
    /** 本轮尚未落盘的秒数（用于「累计时长」显示）。 */
    unflushedSeconds,
    start,
    switchMode,
    switchScope,
    startArticleAll,
    startRelearn,
    grade,
    pressGrade,
    confirmForgot,
    softenForgot,
    cancelForgot,
    back,
    forward,
    markUnknown,
    close,
    retryForgot,
    checkSpelling,
    ackSpellMiss,
    applySpellingMiss,
    openEdit,
    saveEdit,
    removeCard,
  }
}
