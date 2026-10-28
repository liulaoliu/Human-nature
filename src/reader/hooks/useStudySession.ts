import { useCallback, useRef, useState } from 'react'
import {
  canQuizMeaning,
  isRelearning,
  needsMeaningCheck,
  emptyExtraRound,
  type ExtraRound,
} from '../../core/vocab'
import type { VocabItem, VocabLibrary } from '../../types/document'
import type { ActivityCat } from '../../core/activity'
import { useStudyAnswering } from './useStudyAnswering'
import { useStudyCardEdit } from './useStudyCardEdit'
import { useStudyCardUi } from './useStudyCardUi'
import { useStudyGrading } from './useStudyGrading'
import { useStudyPool, type StudyScope } from './useStudyPool'
import { useStudyHotkeys } from './useStudyHotkeys'
import { useStudyStarts } from './useStudyStarts'
import { useStudySpellingRound } from './useStudySpellingRound'
import { useStudySpelling } from './useStudySpelling'
import { useStudySequence } from './useStudySequence'
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
  /** 一张卡的界面开关：翻面 / 输入 / 门禁 / 押后的评分。 */
  const cardUi = useStudyCardUi()
  const {
    revealed,
    setRevealed,
    input,
    setInput,
    checked,
    setChecked,
    meaningCleared,
    resetFlags,
    clearDrill,
    clearMeaningGate,
  } = cardUi
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
  /**
   * 学习模式「4 条释义」那一关的状态（做题 / 揭示 / 等待下一词）。
   * 定义在 `resetCardUi` 之后也没关系：换卡时通过这个 ref 调它的 `reset`。
   */
  const learnResetRef = useRef<() => void>(() => {})
  /** `spellGate` 定义在 `resetCardUi` 之后（要用到 `card`）；换卡时经这个 ref 清判错卡。 */
  const spellGateResetRef = useRef<() => void>(() => {})
  /** 复习模式三键的待定 / 已判状态；换卡时经这个 ref 清掉。 */
  const reviewResetRef = useRef<() => void>(() => {})
  /** `finishGroup` 由 `useStudySequence` 提供；这里存引用给 `spellingRound.onDone` 用。 */
  const finishGroupRef = useRef<(() => void) | null>(null)
  /**
   * 组末拼写测试（学习模式每组结束）：本组全部词挨个拼一遍。
   * 触发与推进在 `useStudySequence`，词的状态机在子 hook 里。
   */
  const spellingRound = useStudySpellingRound({
    onMiss: (item) => {
      // 判定在这里已经定了（again + relearn + 「不认识」标签）；组末是验收，不再本轮重排
      grading.recordRoundTestMiss(item)
      flash(`「${item.word}」拼错了，已判为「不认识」`)
    },
    onDone: () => finishGroupRef.current?.(),
  })

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
    cancelEdit,
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

  /** 换卡时重置卡片 UI 状态（卡面开关 + 编辑草稿 + 各模式子状态）。 */
  const resetCardUi = useCallback(() => {
    resetFlags()
    setEditOpen(false)
    setDraft(null)
    setDelArmed(false)
    spellGateResetRef.current()
    learnResetRef.current()
    reviewResetRef.current()
  }, [resetFlags])

  /** 队列推进 / 组末拼写 / 装轮 / 收尾重练：规则集中在 `useStudySequence`。 */
  const {
    load,
    advanceFrom,
    finishGroup,
    back: backStep,
    forward: forwardStep,
    retryForgot,
    canRetryForgot,
  } = useStudySequence({
    library,
    queue,
    setQueue,
    index,
    setIndex,
    roundTotal,
    setRoundTotal,
    extraRound,
    setExtraRound,
    setRetrying,
    effectiveGroupSize,
    spellingRound,
    grading,
    flash,
    resetCardUi,
  })
  finishGroupRef.current = finishGroup

  /** 拼写判卷 / 确认 / 锤炼拼错：接线在 `useStudySpelling`。 */
  const { spellMiss, resetSpellGate, ackSpellMiss, checkSpelling, applySpellingMiss } = useStudySpelling({
    active: !!queue && !!card,
    card,
    queue,
    grading,
    flash,
    ui: cardUi,
    resetCardUi,
    setIndex,
  })
  spellGateResetRef.current = resetSpellGate

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

  /** 一张卡的答题与判定：评分 / 学习四选项 / 复习三键 / 锤炼门禁。 */
  const {
    grade,
    pressGrade,
    learn,
    reviewStep,
    drillReason,
    drillOn,
    learnPhase,
    learnReveal,
    learnGraded,
    resetLearn,
    resetReview,
  } = useStudyAnswering({
    mode,
    queue,
    index,
    card,
    items: library.items,
    relearning,
    spellMiss,
    spellingRoundActive: !!spellingRound.test,
    spelling,
    meaningGate,
    drillAfter,
    cardSeconds,
    ui: cardUi,
    setEditOpen,
    setDelArmed,
    setIndex,
    advanceFrom,
    grading,
  })
  learnResetRef.current = resetLearn
  reviewResetRef.current = resetReview

  const close = useCallback(() => {
    // 拼错后必须先确认「判为不认识」，不给直接退出把这次判罚吞掉
    if (spellMiss) {
      flash('拼错了：先确认「从头重学」，再退出')
      return
    }
    setQueue(null)
  }, [spellMiss, flash])

  /** 拼错未确认时锁住导航；其余交给 `useStudySequence`。 */
  const back = useCallback(() => {
    if (!spellMiss) backStep()
  }, [spellMiss, backStep])

  const forward = useCallback(() => {
    if (!spellMiss) forwardStep()
  }, [spellMiss, forwardStep])

  /** 标「不认识」：安排复习（按「忘记」重置，比模糊更狠）+ 打标签；**本轮不重排**，不增加本轮总数。 */
  const markUnknown = useCallback(() => {
    if (!queue) return
    const queued = queue[index]
    if (!queued) return
    grading.recordUnknown(queued)
    resetCardUi()
    setIndex((i) => i + 1)
  }, [queue, index, grading.recordUnknown, resetCardUi])

  /** 切拼写模式要先清掉上一题的输入 / 判卷状态，这属于会话规则，不放视图里。 */
  const changeSpelling = useCallback(
    (on: boolean) => {
      setSpelling(on)
      setChecked(false)
      setInput('')
    },
    [setSpelling, setChecked, setInput],
  )

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
    changeSpelling,
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
    canRetryForgot,
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
    /** 锤炼的来路：'timeout' 停太久 / 'relearn' 重学卡评分门禁（界面据此换标题）。 */
    drillReason,
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
    cancelEdit,
    removeCard,
  }
}
