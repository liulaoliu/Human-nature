import { useCallback, useEffect, useRef, type Dispatch, type SetStateAction } from 'react'
import {
  drillReason as getDrillReason,
  type DrillReason,
  type ReviewGrade,
  type StudyMode,
} from '../../core/vocab'
import type { VocabItem } from '../../types/document'
import type { useStudyGrading } from './useStudyGrading'
import type { StudyPendingScore } from './useStudyCardUi'
import { useStudyLearnStep } from './useStudyLearnStep'
import { useStudyReviewStep } from './useStudyReviewStep'
import type { SpellMissCard } from './useStudySpellGate'

/**
 * 一张卡的「答题与判定」：评分押后、学习四选项、复习三键、锤炼门禁。
 *
 * 从 `useStudySession` 抽出来。它和 `useStudyCardUi` 的分界是：
 * 卡面开关（翻面 / 输入 / 门禁标记）归前者，**什么情况下能判、判完推不推进**归这里。
 * 两者都不写词库——真正落库只在 `useStudyGrading`。
 */

type AnsweringGrading = Pick<ReturnType<typeof useStudyGrading>, 'recordGrade'>

export interface UseStudyAnsweringParams {
  mode: StudyMode
  queue: VocabItem[] | null
  index: number
  card: VocabItem | null
  items: VocabItem[]
  relearning: boolean
  spellMiss: SpellMissCard | null
  /** 组末拼写测试进行中：此时不许评分。 */
  spellingRoundActive: boolean
  spelling: boolean
  checked: boolean
  meaningGate: boolean
  drillAfter: number
  cardSeconds: number
  drillCleared: boolean
  pendingScore: StudyPendingScore | null
  setPendingScore: Dispatch<SetStateAction<StudyPendingScore | null>>
  setRevealed: Dispatch<SetStateAction<boolean>>
  setEditOpen: Dispatch<SetStateAction<boolean>>
  setDelArmed: Dispatch<SetStateAction<boolean>>
  resetFlags: () => void
  setIndex: Dispatch<SetStateAction<number>>
  advanceFrom: (from: number) => void
  grading: AnsweringGrading
}

export function useStudyAnswering({
  mode,
  queue,
  index,
  card,
  items,
  relearning,
  spellMiss,
  spellingRoundActive,
  spelling,
  checked,
  meaningGate,
  drillAfter,
  cardSeconds,
  drillCleared,
  pendingScore,
  setPendingScore,
  setRevealed,
  setEditOpen,
  setDelArmed,
  resetFlags,
  setIndex,
  advanceFrom,
  grading,
}: UseStudyAnsweringParams) {
  /**
   * 真正落库的评分。账本在 `grading.recordGrade`；这里只负责「清卡片 UI」和「要不要推进」。
   *
   * `opts.advance = false`：只写库不跳下一张（学习模式判完要停在单词卡等「下一词」）。
   * `opts.learnPass`：学习模式里把「这次有没有没看答案就选对」一起写进
   * `ReviewState.meaningPasses`——两次 persist 会互相覆盖，所以必须一次算完。
   */
  const applyGrade = useCallback(
    (g: ReviewGrade, opts?: { advance?: boolean; learnPass?: boolean }) => {
      if (spellMiss || spellingRoundActive) return
      if (!queue) return
      const queued = queue[index]
      if (!queued) return
      // 重学卡 + 还没过锤炼 → 评分押后：先进锤炼板，过了再落库。
      if (relearning && !drillCleared && !pendingScore) {
        setPendingScore({ grade: g, advance: opts?.advance !== false })
        return
      }
      grading.recordGrade(g, queued, opts?.learnPass)
      resetFlags()
      setEditOpen(false)
      setDelArmed(false)
      if (opts?.advance !== false) {
        // 复习模式「认识」直接推进：组末拼写挂在这条路上；
        // 学习模式判完不推进（advance:false），组末由「下一词 / E」的 forward 触发。
        if (mode === 'review') advanceFrom(index)
        else setIndex((i) => i + 1)
      }
    },
    [
      queue,
      index,
      grading.recordGrade,
      spellMiss,
      spellingRoundActive,
      mode,
      advanceFrom,
      relearning,
      drillCleared,
      pendingScore,
      setPendingScore,
      resetFlags,
      setEditOpen,
      setDelArmed,
      setIndex,
    ],
  )

  /**
   * 锤炼通过 → 把「押后」的评分落库（重学卡上先做一道题，过了才按他点的分记）。
   *
   * 走 ref 而不是直接调：同一个 render 里 `setDrillCleared(true)` 还没生效，
   * 直接调会被当成「还没过锤炼」再押一次。放进 effect 后 `drillCleared` 已是新值。
   */
  const applyGradeRef = useRef(applyGrade)
  applyGradeRef.current = applyGrade
  useEffect(() => {
    if (!drillCleared || !pendingScore) return
    const p = pendingScore
    setPendingScore(null)
    applyGradeRef.current(p.grade, { advance: p.advance })
  }, [drillCleared, pendingScore, setPendingScore])

  /** 学习模式「4 条中文释义」：判定规则在 core，卡片状态机在 `useStudyLearnStep`。 */
  const learn = useStudyLearnStep({
    mode,
    card,
    items,
    active: !!queue && !!card,
    judge: (g, learnPass) => applyGrade(g, { advance: false, learnPass }),
    showCard: () => setRevealed(true),
  })

  /** 卡停超时；「该不该真锤炼」还要看是不是已经判完停着，见 `drillReason`。 */
  const drillTimedOut = drillAfter > 0 && cardSeconds >= drillAfter && !drillCleared

  /** 复习模式三键：认识直接推进；模糊先摊卡不写库；释义门禁 / 锤炼进行中不抢。 */
  const reviewStep = useStudyReviewStep({
    mode,
    active: !!queue && !!card,
    ready: !meaningGate && !drillTimedOut && !learn.learnPhase && !spellMiss && !(spelling && !checked),
    judge: (g, advance) => applyGrade(g, { advance }),
    showCard: () => setRevealed(true),
  })

  /**
   * 强制锤炼的来路：'timeout' 停太久 / 'relearn' 重学卡评分门禁。
   * 已经判完停着等「下一词」的卡不锤炼（规则在 `core/vocab/drill`）。
   */
  const drillReason: DrillReason | null = getDrillReason({
    active: !!queue && !!card,
    spellMiss: !!spellMiss,
    learnPhase: learn.learnPhase,
    parked: learn.learnGraded || reviewStep.graded || reviewStep.fuzzy,
    timedOut: drillTimedOut,
    relearnScoring: !!pendingScore,
    cleared: drillCleared,
  })

  const grade = useCallback((g: ReviewGrade) => applyGrade(g), [applyGrade])

  /** 面板「认识 / 模糊 / 忘记了」：复习模式走三键状态机，其它模式走评分。 */
  const pressGrade = useCallback(
    (g: ReviewGrade) => (mode === 'review' ? reviewStep.answer(g) : grade(g)),
    [mode, reviewStep.answer, grade],
  )

  return {
    applyGrade,
    grade,
    pressGrade,
    learn,
    reviewStep,
    drillTimedOut,
    drillReason,
    drillOn: drillReason !== null,
    learnPhase: learn.learnPhase,
    learnReveal: learn.learnReveal,
    learnGraded: learn.learnGraded,
    resetLearn: learn.reset,
    resetReview: reviewStep.reset,
  }
}
