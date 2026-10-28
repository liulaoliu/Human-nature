// @vitest-environment jsdom
import { useRef, useState } from 'react'
import { describe, it, expect, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { createLibrary, emptyExtraRound } from '../../core/vocab'
import { vocabItem } from '../../core/testFixtures'
import type { VocabItem, VocabLibrary } from '../../types/document'
import { useStudySpellingRound } from './useStudySpellingRound'
import { useStudySequence } from './useStudySequence'

/**
 * 队列时序的边界：组末先拼写、拼完才推进；加练卡不触发组末；重练每轮只发起一次。
 * 上层 `useStudySession` 已有端到端覆盖，这里直接钉住拆出来的状态机。
 */

const words = () => [
  vocabItem({ id: 'w1', word: 'one', lemma: 'one', meaning: '一' }),
  vocabItem({ id: 'w2', word: 'two', lemma: 'two', meaning: '二' }),
  vocabItem({ id: 'w3', word: 'three', lemma: 'three', meaning: '三' }),
]

function useHarness({
  items,
  roundTotal,
  initialIndex = 0,
  groupSize = 2,
  forgotIds = [],
}: {
  items: VocabItem[]
  roundTotal?: number
  initialIndex?: number
  groupSize?: number
  forgotIds?: string[]
}) {
  const [queue, setQueue] = useState<VocabItem[] | null>(items)
  const [index, setIndex] = useState(initialIndex)
  const [roundTotalState, setRoundTotal] = useState(roundTotal ?? items.length)
  const [extraRound, setExtraRound] = useState(emptyExtraRound)
  const [retrying, setRetrying] = useState(false)
  const flash = useRef(vi.fn()).current
  const resetCardUi = useRef(vi.fn()).current
  const grading = useRef({
    resetLedger: vi.fn(),
    getForgotIds: vi.fn(() => forgotIds),
  }).current
  const finishRef = useRef<() => void>(() => {})
  const spellingRound = useStudySpellingRound({
    onMiss: vi.fn(),
    onDone: () => finishRef.current(),
  })
  const sequence = useStudySequence({
    library: { ...createLibrary(), items } as VocabLibrary,
    queue,
    setQueue,
    index,
    setIndex,
    roundTotal: roundTotalState,
    setRoundTotal,
    extraRound,
    setExtraRound,
    setRetrying,
    effectiveGroupSize: groupSize,
    spellingRound,
    grading,
    flash,
    resetCardUi,
  })
  finishRef.current = sequence.finishGroup
  return { sequence, spellingRound, index, queue, roundTotalState, retrying, flash, resetCardUi, grading }
}

const current = (hook: ReturnType<typeof renderHook<ReturnType<typeof useHarness>, unknown>>) =>
  hook.result.current

describe('useStudySequence：组末拼写与推进', () => {
  it('到组末先开始拼写，不直接翻页；拼完才把指针推到组末', () => {
    const hook = renderHook(() => useHarness({ items: words(), initialIndex: 1, groupSize: 2 }))
    act(() => current(hook).sequence.advanceFrom(1))

    expect(current(hook).index).toBe(1)
    expect(current(hook).spellingRound.test).toEqual({ index: 0, total: 2 })
    expect(current(hook).spellingRound.card?.id).toBe('w1')

    act(() => current(hook).spellingRound.setInput('one'))
    act(() => current(hook).spellingRound.check())
    act(() => current(hook).spellingRound.setInput('two'))
    act(() => current(hook).spellingRound.check())

    expect(current(hook).index).toBe(2)
    expect(current(hook).spellingRound.test).toBeNull()
  })

  it('加练卡（index ≥ roundTotal）只翻页，不触发组末拼写', () => {
    const hook = renderHook(() =>
      useHarness({ items: words(), roundTotal: 1, initialIndex: 1, groupSize: 2 }),
    )
    act(() => current(hook).sequence.advanceFrom(1))

    expect(current(hook).index).toBe(2)
    expect(current(hook).spellingRound.test).toBeNull()
  })

  it('load 重置账本与指针、清掉未完成的组末，并冻结新的分母', () => {
    const hook = renderHook(() => useHarness({ items: words() }))
    // 先进入组末拼写，再用新队列开一轮：旧组的组末下标不能留到下一轮
    act(() => current(hook).sequence.advanceFrom(1))
    expect(current(hook).spellingRound.test).not.toBeNull()

    act(() => current(hook).sequence.load([words()[0]], { retrying: true }))
    act(() => current(hook).sequence.finishGroup())

    expect(current(hook).queue).toHaveLength(1)
    expect(current(hook).index).toBe(0)
    expect(current(hook).spellingRound.test).toBeNull()
    expect(current(hook).roundTotalState).toBe(1)
    expect(current(hook).retrying).toBe(true)
    expect(current(hook).grading.resetLedger).toHaveBeenCalled()
    expect(current(hook).resetCardUi).toHaveBeenCalled()
  })
})

describe('useStudySequence：收尾重练', () => {
  it('重练忘记的词：换队列、重置账本、标 retrying', () => {
    const items = words()
    const hook = renderHook(() => useHarness({ items, forgotIds: ['w1'] }))
    act(() => current(hook).sequence.retryForgot())

    expect(current(hook).queue?.map((it) => it.id)).toEqual(['w1'])
    expect(current(hook).roundTotalState).toBe(1)
    expect(current(hook).retrying).toBe(true)
    expect(current(hook).grading.resetLedger).toHaveBeenCalled()
  })

  it('每轮只发起一次；第二次给出提示且不再换队列', () => {
    const hook = renderHook(() => useHarness({ items: words(), forgotIds: ['w1'] }))
    act(() => current(hook).sequence.retryForgot())
    act(() => current(hook).sequence.retryForgot())

    expect(current(hook).flash).toHaveBeenCalledWith('本轮已经重练过忘记的词了')
    expect(current(hook).queue?.map((it) => it.id)).toEqual(['w1'])
  })
})
