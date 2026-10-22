// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, render } from '@testing-library/react'
import { useStudyLearnStep, type StudyLearnStep } from './useStudyLearnStep'
import { vocabItem } from '../../core/testFixtures'
import type { VocabItem } from '../../types/document'
import type { ReviewGrade } from '../../core/vocab'

/**
 * 学习模式「4 条释义」这一关的状态机：判定交给 core，这里只测
 * 「做了什么 → 停在哪个界面、有没有落库、停留能不能打断」。
 */
let api: StudyLearnStep | null = null
const judged: { grade: ReviewGrade; pass: boolean }[] = []
const showCard = vi.fn()

function Harness({
  card,
  mode = 'learn',
  items = [],
  active = true,
}: {
  card: VocabItem | null
  mode?: 'learn' | 'review'
  items?: VocabItem[]
  active?: boolean
}) {
  api = useStudyLearnStep({
    mode,
    card,
    items,
    active,
    judge: (g, pass) => judged.push({ grade: g, pass }),
    showCard,
  })
  return null
}

/** 4 个不同释义：够出「正确 + 3 干扰项」。 */
const fresh = () =>
  vocabItem({ id: 'n1', word: 'run', lemma: 'run', meaning: '跑', reviewState: { ease: 2.5, due: null, interval: 0, repetitions: 0 } })
const others = () => [
  vocabItem({ id: 'n2', word: 'walk', lemma: 'walk', meaning: '走' }),
  vocabItem({ id: 'n3', word: 'say', lemma: 'say', meaning: '说' }),
  vocabItem({ id: 'n4', word: 'see', lemma: 'see', meaning: '看' }),
]

beforeEach(() => {
  judged.length = 0
  showCard.mockClear()
  api = null
})
afterEach(() => {
  vi.useRealTimers()
})

describe('useStudyLearnStep：出不出这一关', () => {
  it('学习模式的新词才走「4 条释义」；复习模式不出', () => {
    const { unmount } = render(<Harness card={fresh()} items={others()} />)
    expect(api!.learnPhase).toBe(true)
    unmount()

    render(<Harness card={fresh()} items={others()} mode="review" />)
    expect(api!.learnPhase).toBe(false)
  })

  it('重学中的词不抢这一关（它走锤炼）', () => {
    const card = { ...fresh(), reviewState: { ease: 2.5, due: null, interval: 0, repetitions: 0, relearn: 1 } } as VocabItem
    render(<Harness card={card} items={others()} />)
    expect(api!.learnPhase).toBe(false)
  })

  it('词库不足 4 个释义 / 没在背：不出题，退回普通卡', () => {
    render(<Harness card={fresh()} items={others().slice(0, 1)} />)
    expect(api!.learnPhase).toBe(false)
    render(<Harness card={fresh()} items={others()} active={false} />)
    expect(api!.learnPhase).toBe(false)
  })
})

describe('useStudyLearnStep：判定与停留', () => {
  it('看答案：判不认识 → 高亮正确项 → 停一下自动进单词卡（可打断）', () => {
    vi.useFakeTimers()
    const { unmount } = render(<Harness card={fresh()} items={others()} />)
    act(() => api!.revealAnswer())
    expect(judged).toEqual([{ grade: 'again', pass: false }])
    expect(api!.learnReveal).toMatchObject({ wrong: null, auto: true })
    expect(api!.learnGraded).toBe(true)
    expect(showCard).not.toHaveBeenCalled()

    act(() => vi.advanceTimersByTime(600))
    expect(showCard).toHaveBeenCalledTimes(1)
    expect(api!.learnReveal).toBeNull()
    unmount()
  })

  it('选对：首次判模糊并记一次，直接进单词卡', () => {
    const { unmount } = render(<Harness card={fresh()} items={others()} />)
    act(() => api!.answer(2, true))
    expect(judged).toEqual([{ grade: 'hard', pass: true }])
    expect(showCard).toHaveBeenCalledTimes(1)
    expect(api!.learnGraded).toBe(true)
    unmount()
  })

  it('选错：判不认识，停在高亮页等「继续」（不自动进卡）', () => {
    const { unmount } = render(<Harness card={fresh()} items={others()} />)
    act(() => api!.answer(1, false))
    expect(judged).toEqual([{ grade: 'again', pass: false }])
    expect(api!.learnReveal).toMatchObject({ wrong: 1, auto: false })
    expect(showCard).not.toHaveBeenCalled()

    act(() => api!.continueNow())
    expect(showCard).toHaveBeenCalledTimes(1)
    expect(api!.learnReveal).toBeNull()
    unmount()
  })

  it('这一卡判过之后不再重复判定', () => {
    render(<Harness card={fresh()} items={others()} />)
    act(() => api!.answer(0, true))
    act(() => api!.answer(1, false))
    act(() => api!.revealAnswer())
    expect(judged).toHaveLength(1)
  })

  it('换卡 reset：清掉高亮与已判标记，停留定时器不再触发', () => {
    vi.useFakeTimers()
    render(<Harness card={fresh()} items={others()} />)
    act(() => api!.revealAnswer())
    act(() => api!.reset())
    expect(api!.learnReveal).toBeNull()
    expect(api!.learnGraded).toBe(false)
    act(() => vi.advanceTimersByTime(1000))
    expect(showCard).not.toHaveBeenCalled()
  })
})
