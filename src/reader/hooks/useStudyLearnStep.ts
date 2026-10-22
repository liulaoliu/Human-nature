import { useCallback, useEffect, useRef, useState } from 'react'
import type { VocabItem } from '../../types/document'
import {
  canQuizMeaning,
  correctOptionIndex,
  gradeLearnStep,
  isFresh,
  isRelearning,
  meaningPassesOf,
  LEARN_REVEAL_HOLD_MS,
  type ReviewGrade,
  type StudyMode,
} from '../../core/vocab'
import type { MeaningReveal } from '../panels/StudyDrill'

/**
 * 学习模式「4 条中文释义」这一关的卡片状态（从 `useStudySession` 拆出来）。
 *
 * 拆的理由不只是行数：`useStudySession` 已经要管队列 / 评分 / 加练 / 拼写 / 锤炼，
 * 学习模式又多了一套「做题 → 判定 → 停留 → 进卡 → 等下一词」的小状态机，
 * 混在一起没人看得清哪一步归谁管。这里只管这一关，落库与翻面都回调给主 hook。
 *
 * 判定规则本身不在这里（在 `core/vocab/learnStep`）：看答案 / 选错 = 不认识，
 * 首次选对 = 模糊，第二次起 = 认识。
 */

export interface UseStudyLearnStepParams {
  mode: StudyMode
  card: VocabItem | null
  /** 整个词库：干扰项来源，也用来判断「够不够出 4 个选项」。 */
  items: VocabItem[]
  /** 有没有在背（没开始 / 本轮结束 → 不做任何判定）。 */
  active: boolean
  /** 判定后落库：主 hook 的 `applyGrade(grade, { advance: false, learnPass })`。 */
  judge: (grade: ReviewGrade, learnPass: boolean) => void
  /** 进单词卡：主 hook 的 `setRevealed(true)`。 */
  showCard: () => void
}

export interface StudyLearnStep {
  /** 这一卡正在过「4 条释义」这一关（判完才进单词卡）。 */
  learnPhase: boolean
  /** 揭示答案后的高亮（正确项浅绿 / 选错项浅红；auto = 停留后自动进卡）。 */
  learnReveal: MeaningReveal | null
  /** 这一卡已经判过：停在单词卡等「下一词」，不再评分。 */
  learnGraded: boolean
  /** 点「看答案」：判不认识 → 高亮 → 停留一下自动进卡（可打断）。 */
  revealAnswer: () => void
  /** 选了某一项：判定 + 落库；选错停在高亮页等「继续」。 */
  answer: (index: number, correct: boolean) => void
  /** 打断停留 / 点「继续」：立刻进单词卡。 */
  continueNow: () => void
  /** 换卡：清掉这一关的所有状态与定时器。 */
  reset: () => void
}

export function useStudyLearnStep(params: UseStudyLearnStepParams): StudyLearnStep {
  const { mode, card, items, active, judge, showCard } = params
  // 回调每次 render 都是新函数，但只在事件里用：存 ref，免得把它们塞进依赖数组
  const judgeRef = useRef(judge)
  const showCardRef = useRef(showCard)
  judgeRef.current = judge
  showCardRef.current = showCard

  const [learnReveal, setLearnReveal] = useState<MeaningReveal | null>(null)
  const [learnGraded, setLearnGraded] = useState(false)
  /** 「看答案」后的停留定时器（可被 `continueNow` 打断）。 */
  const holdTimer = useRef<number | null>(null)

  const clearHold = useCallback(() => {
    if (holdTimer.current != null) {
      window.clearTimeout(holdTimer.current)
      holdTimer.current = null
    }
  }, [])
  useEffect(() => clearHold, [clearHold])

  /**
   * 只有**新词**走这一关：`isFresh`（从没排期过）。
   * 重学中的词、加练重排回来的词各有自己的路（锤炼 / 复习门禁），不在这里抢。
   */
  const canLearnQuiz =
    mode === 'learn' && !!card && isFresh(card) && !isRelearning(card) && canQuizMeaning(card, items)
  const learnPhase = active && !!card && canLearnQuiz && !learnGraded

  const enterCard = useCallback(() => {
    clearHold()
    setLearnReveal(null)
    showCardRef.current()
  }, [clearHold])

  const revealAnswer = useCallback(() => {
    if (!card || learnReveal || learnGraded) return
    const step = gradeLearnStep({ action: 'reveal', passes: meaningPassesOf(card), canQuiz: true })
    if (step.kind !== 'hold') return
    judgeRef.current(step.grade, false)
    setLearnReveal({ correct: correctOptionIndex(card, items), wrong: null, auto: true })
    setLearnGraded(true)
    clearHold()
    holdTimer.current = window.setTimeout(() => {
      holdTimer.current = null
      setLearnReveal(null)
      showCardRef.current()
    }, LEARN_REVEAL_HOLD_MS)
  }, [card, items, learnReveal, learnGraded, clearHold])

  const answer = useCallback(
    (index: number, correct: boolean) => {
      if (!card || learnReveal || learnGraded) return
      const step = gradeLearnStep({
        action: correct ? 'correct' : 'wrong',
        passes: meaningPassesOf(card),
        canQuiz: true,
      })
      if (step.kind === 'fallback') return
      judgeRef.current(step.grade, step.kind === 'card' && step.pass)
      setLearnGraded(true)
      if (step.kind === 'hold') {
        setLearnReveal({ correct: correctOptionIndex(card, items), wrong: index, auto: false })
        return
      }
      enterCard()
    },
    [card, items, learnReveal, learnGraded, enterCard],
  )

  const continueNow = useCallback(() => {
    if (!learnReveal) return
    enterCard()
  }, [learnReveal, enterCard])

  const reset = useCallback(() => {
    clearHold()
    setLearnReveal(null)
    setLearnGraded(false)
  }, [clearHold])

  return { learnPhase, learnReveal, learnGraded, revealAnswer, answer, continueNow, reset }
}
