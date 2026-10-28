// @vitest-environment jsdom
import { useRef, useState } from 'react'
import { describe, it, expect, vi } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'
import type { StudyMode } from '../../core/vocab'
import { vocabItem } from '../../core/testFixtures'
import { useStudyCardUi } from './useStudyCardUi'
import { useStudyAnswering } from './useStudyAnswering'

/**
 * 答题判定的边界：只写库不推进、复习推进走组末路径、重学卡评分押后到锤炼通过。
 * 这些规则以前埋在 `useStudySession` 的 `applyGrade` 里，拆出来后直接钉住。
 */

const items = () => [
  vocabItem({ id: 'w1', word: 'one', lemma: 'one', meaning: '一' }),
  vocabItem({ id: 'w2', word: 'two', lemma: 'two', meaning: '二' }),
]

const noop = () => {}

function useHarness({
  mode = 'learn' as StudyMode,
  relearning = false,
  spellingRoundActive = false,
  drillAfter = 0,
  cardSeconds = 0,
}: {
  mode?: StudyMode
  relearning?: boolean
  spellingRoundActive?: boolean
  drillAfter?: number
  cardSeconds?: number
} = {}) {
  const list = useRef(items()).current
  const [index, setIndex] = useState(0)
  const ui = useStudyCardUi()
  const grading = useRef({ recordGrade: vi.fn() }).current
  const advanceFrom = useRef(vi.fn()).current
  const answer = useStudyAnswering({
    mode,
    queue: list,
    index,
    card: list[index] ?? null,
    items: list,
    relearning,
    spellMiss: null,
    spellingRoundActive,
    spelling: false,
    meaningGate: false,
    drillAfter,
    cardSeconds,
    ui,
    setEditOpen: noop,
    setDelArmed: noop,
    setIndex,
    advanceFrom,
    grading,
  })
  return { answer, ui, index, grading, advanceFrom }
}

describe('useStudyAnswering：评分推进', () => {
  it('advance:false 只写库，不换卡（学习模式判完先停在单词卡）', () => {
    const hook = renderHook(() => useHarness())
    act(() => hook.result.current.answer.applyGrade('good', { advance: false }))

    expect(hook.result.current.grading.recordGrade).toHaveBeenCalledWith(
      'good',
      expect.objectContaining({ id: 'w1' }),
      undefined,
    )
    expect(hook.result.current.index).toBe(0)
  })

  it('学习模式正常评分推进到下一张；复习模式走 advanceFrom（组末拼写挂在路上）', () => {
    const learn = renderHook(() => useHarness({ mode: 'learn' }))
    act(() => learn.result.current.answer.applyGrade('good'))
    expect(learn.result.current.index).toBe(1)
    expect(learn.result.current.advanceFrom).not.toHaveBeenCalled()

    const review = renderHook(() => useHarness({ mode: 'review' }))
    act(() => review.result.current.answer.applyGrade('good'))
    expect(review.result.current.advanceFrom).toHaveBeenCalledWith(0)
  })

  it('组末拼写进行中不许评分', () => {
    const hook = renderHook(() => useHarness({ spellingRoundActive: true }))
    act(() => hook.result.current.answer.applyGrade('good'))

    expect(hook.result.current.grading.recordGrade).not.toHaveBeenCalled()
  })
})

describe('useStudyAnswering：重学卡的评分门禁', () => {
  it('重学卡评分先押后，锤炼通过后才落库并按原分推进', async () => {
    const hook = renderHook(() => useHarness({ relearning: true }))
    act(() => hook.result.current.answer.applyGrade('good'))

    expect(hook.result.current.grading.recordGrade).not.toHaveBeenCalled()
    expect(hook.result.current.ui.pendingScore).toEqual({ grade: 'good', advance: true })

    act(() => hook.result.current.ui.clearDrill())
    await waitFor(() => {
      expect(hook.result.current.grading.recordGrade).toHaveBeenCalledWith(
        'good',
        expect.objectContaining({ id: 'w1' }),
        undefined,
      )
    })
    expect(hook.result.current.ui.pendingScore).toBeNull()
    expect(hook.result.current.index).toBe(1)
  })

  it('换卡重置会丢掉押后的评分，避免记到下一张卡', () => {
    const hook = renderHook(() => useHarness({ relearning: true }))
    act(() => hook.result.current.answer.applyGrade('good'))
    act(() => hook.result.current.ui.resetFlags())

    expect(hook.result.current.ui.pendingScore).toBeNull()
  })
})
