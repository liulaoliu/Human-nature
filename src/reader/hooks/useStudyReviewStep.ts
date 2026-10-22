import { useCallback, useRef, useState } from 'react'
import { planReviewFuzzyChoice, planReviewGrade, type ReviewFuzzyChoice, type ReviewStepPlan } from '../../core/vocab'
import type { ReviewGrade } from '../../core/vocab'

/**
 * 复习模式「只显示单词 + 三键」的卡片状态（从 `useStudySession` 拆出来）。
 *
 * 只管三件事：三键能不能按、按了之后摊不摊卡、摊卡之后等哪个出口。
 * **落库一律回调主 hook**（`judge(grade, advance)` → `applyGrade`）：
 * 判「模糊」时故意不写库，等用户选完「下一词 / 记错了」再写一次——
 * 一次决定一次落库，统计里也只算一次（规则见 `core/vocab/reviewStep`）。
 */

export interface UseStudyReviewStepParams {
  /** 只有复习模式用这条路（学习模式有自己的四选项关卡）。 */
  mode: 'learn' | 'review'
  /** 有没有在背（没开始 / 本轮结束 → 不做任何判定）。 */
  active: boolean
  /**
   * 复习模式三键当前是否可点：
   * 重学卡要先走「看词 → 释义 → 锤炼」，释义门禁 / 锤炼进行中也不许抢。
   */
  ready: boolean
  /** 落库：主 hook 的 `applyGrade(grade, { advance })`。 */
  judge: (grade: ReviewGrade, advance: boolean) => void
  /** 摊开单词卡：主 hook 的 `setRevealed(true)`。 */
  showCard: () => void
}

export interface StudyReviewStep {
  /** 三键直接可点（不用先翻面）。 */
  keysReady: boolean
  /** 模糊待定：卡片已摊开，等「下一词」/「记错了」。 */
  fuzzy: boolean
  /** 已判过并停在卡上（忘记 / 记错了），等「下一词」。 */
  graded: boolean
  /** 按三键之一。 */
  answer: (grade: ReviewGrade) => void
  /** 模糊之后的出口：「下一词」/「记错了」。 */
  choose: (choice: ReviewFuzzyChoice) => void
  /** 换卡 / 重开一轮：清掉待定与已判状态。 */
  reset: () => void
}

export function useStudyReviewStep(params: UseStudyReviewStepParams): StudyReviewStep {
  const { mode, active, ready, judge, showCard } = params
  const judgeRef = useRef(judge)
  const showCardRef = useRef(showCard)
  judgeRef.current = judge
  showCardRef.current = showCard

  const [fuzzy, setFuzzy] = useState(false)
  const [graded, setGraded] = useState(false)

  /**
   * 把一次判定翻译成「写库 / 摊卡 / 停住」，两个入口（三键、模糊出口）共用。
   * 「已判」只指**写完了库还停在卡上**；模糊待定时还没写库，归 `fuzzy` 管。
   */
  const run = useCallback((plan: ReviewStepPlan) => {
    if (plan.commit) judgeRef.current(plan.commit, plan.advance)
    if (plan.showCard) showCardRef.current()
    setGraded(plan.commit != null && !plan.advance)
  }, [])

  const answer = useCallback(
    (grade: ReviewGrade) => {
      if (mode !== 'review' || !active || !ready || fuzzy || graded) return
      const plan = planReviewGrade(grade)
      // 模糊先不落库：只进「待定」态，等 choose 决定写 hard 还是 again
      if (!plan.commit) setFuzzy(true)
      run(plan)
    },
    [mode, active, ready, fuzzy, graded, run],
  )

  const choose = useCallback(
    (choice: ReviewFuzzyChoice) => {
      if (!fuzzy) return
      setFuzzy(false)
      run(planReviewFuzzyChoice(choice))
    },
    [fuzzy, run],
  )

  const reset = useCallback(() => {
    setFuzzy(false)
    setGraded(false)
  }, [])

  const keysReady = mode === 'review' && active && ready && !fuzzy && !graded
  return { keysReady, fuzzy, graded, answer, choose, reset }
}
