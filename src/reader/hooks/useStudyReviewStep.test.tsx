// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, render } from '@testing-library/react'
import { useStudyReviewStep, type StudyReviewStep } from './useStudyReviewStep'
import type { ReviewGrade } from '../../core/vocab'

/**
 * 复习模式三键：认识直接推进、模糊先不写库（摊卡等选择）、忘记立刻判不认识并停卡。
 * 这里只测「按下去之后做了什么」——排期算法在 core/vocab/review，三键口径在 reviewStep。
 */
let api: StudyReviewStep | null = null
const judged: { grade: ReviewGrade; advance: boolean }[] = []
const showCard = vi.fn()

function Harness({
  mode = 'review',
  active = true,
  ready = true,
}: {
  mode?: 'learn' | 'review'
  active?: boolean
  ready?: boolean
}) {
  api = useStudyReviewStep({
    mode,
    active,
    ready,
    judge: (grade, advance) => judged.push({ grade, advance }),
    showCard,
  })
  return null
}

beforeEach(() => {
  judged.length = 0
  showCard.mockClear()
  api = null
})

describe('useStudyReviewStep：三键什么时候可点', () => {
  it('复习模式 + 在背 + 没被门禁/锤炼占住 → 可直接判（不用先翻面）', () => {
    render(<Harness />)
    expect(api!.keysReady).toBe(true)
  })

  it('学习模式 / 没开始 / 被门禁占住 → 不给三键', () => {
    render(<Harness mode="learn" />)
    expect(api!.keysReady).toBe(false)
    render(<Harness active={false} />)
    expect(api!.keysReady).toBe(false)
    render(<Harness ready={false} />)
    expect(api!.keysReady).toBe(false)
  })
})

describe('useStudyReviewStep：三键各做什么', () => {
  it('认识：写 good 并直接推进，不摊卡', () => {
    render(<Harness />)
    act(() => api!.answer('good'))
    expect(judged).toEqual([{ grade: 'good', advance: true }])
    expect(showCard).not.toHaveBeenCalled()
    expect(api!.fuzzy).toBe(false)
    expect(api!.graded).toBe(false)
  })

  it('模糊：先不写库，摊开单词卡等选择（避免 hard → again 连着落两次库）', () => {
    render(<Harness />)
    act(() => api!.answer('hard'))
    expect(judged).toEqual([])
    expect(showCard).toHaveBeenCalledTimes(1)
    expect(api!.fuzzy).toBe(true)
    expect(api!.keysReady).toBe(false)
  })

  it('忘记：立刻判不认识（again）并停卡，等「下一词」', () => {
    render(<Harness />)
    act(() => api!.answer('again'))
    expect(judged).toEqual([{ grade: 'again', advance: false }])
    expect(showCard).toHaveBeenCalledTimes(1)
    expect(api!.graded).toBe(true)
    expect(api!.keysReady).toBe(false)
  })

  it('模糊 → 下一词：认下模糊（hard）并推进', () => {
    render(<Harness />)
    act(() => api!.answer('hard'))
    act(() => api!.choose('next'))
    expect(judged).toEqual([{ grade: 'hard', advance: true }])
    expect(api!.fuzzy).toBe(false)
    expect(api!.graded).toBe(false)
  })

  it('模糊 → 记错了：改成不认识（again），继续停在卡上看答案', () => {
    render(<Harness />)
    act(() => api!.answer('hard'))
    act(() => api!.choose('missed'))
    expect(judged).toEqual([{ grade: 'again', advance: false }])
    expect(api!.graded).toBe(true)
  })
})

describe('useStudyReviewStep：防重复判定与换卡', () => {
  it('判过之后三键不再写库，模糊以外的出口也不生效', () => {
    render(<Harness />)
    act(() => api!.answer('again'))
    act(() => api!.answer('good'))
    act(() => api!.choose('next'))
    expect(judged).toHaveLength(1)
  })

  it('模糊待定时按三键不再叠判定（先选出口）', () => {
    render(<Harness />)
    act(() => api!.answer('hard'))
    act(() => api!.answer('again'))
    expect(judged).toEqual([])
  })

  it('reset 清掉待定与已判，三键恢复可点', () => {
    render(<Harness />)
    act(() => api!.answer('hard'))
    act(() => api!.reset())
    expect(api!.fuzzy).toBe(false)
    expect(api!.graded).toBe(false)
    expect(api!.keysReady).toBe(true)
  })
})
