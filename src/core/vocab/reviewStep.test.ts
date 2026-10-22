import { describe, expect, it } from 'vitest'
import { planReviewFuzzyChoice, planReviewGrade } from './reviewStep'

/**
 * 复习模式三键的落库口径：认识直接推进、模糊先不写库（等用户看过释义再决定）、
 * 忘记立刻判不认识并停卡。这里只测「按下去之后做什么」，不测排期算法（在 review.test）。
 */
describe('planReviewGrade：三键怎么落库', () => {
  it('认识：写 good 并直接换下一张，不摊卡', () => {
    expect(planReviewGrade('good')).toEqual({ commit: 'good', advance: true, showCard: false })
  })

  it('easy 也是直接推进（保留 SM-2 的第四档）', () => {
    expect(planReviewGrade('easy')).toEqual({ commit: 'easy', advance: true, showCard: false })
  })

  it('模糊：先不写库、不推进，只摊开单词卡等用户选', () => {
    expect(planReviewGrade('hard')).toEqual({ commit: null, advance: false, showCard: true })
  })

  it('忘记了：立刻判不认识（again），停在卡上让用户看一眼答案', () => {
    expect(planReviewGrade('again')).toEqual({ commit: 'again', advance: false, showCard: true })
  })
})

describe('planReviewFuzzyChoice：模糊之后的两个出口', () => {
  it('「下一词」= 认下模糊：写 hard 并推进', () => {
    expect(planReviewFuzzyChoice('next')).toEqual({ commit: 'hard', advance: true, showCard: false })
  })

  it('「记错了」= 改成不认识：写 again，继续停在卡上看答案', () => {
    expect(planReviewFuzzyChoice('missed')).toEqual({ commit: 'again', advance: false, showCard: true })
  })

  it('两个出口一次只写一次库（不会 hard → again 连着写）', () => {
    const plan = planReviewGrade('hard')
    expect(plan.commit).toBeNull()
    expect(planReviewFuzzyChoice('missed').commit).toBe('again')
  })
})
