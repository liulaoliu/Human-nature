// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useState } from 'react'
import { useProductionJump } from './useProductionJump'
import type { ProductionAttemptSnapshot } from './useProductionAttempt'
import type { ProductionPrompt } from '../../core/production'

/**
 * 断句列表跳题 —— 两条容易回归的语义：
 * 1. 跳走再跳回来，那一题写了一半的答案要还在（按题存快照，不是清空）；
 * 2. 「已交」按 doneIds 记 —— 跳着做之后不能再用「在第几题之前」推断。
 */
const prompt = (id: string): ProductionPrompt => ({
  id,
  zh: `句子 ${id}`,
  goal: '',
  targets: [],
})

const snap = (answer: string): ProductionAttemptSnapshot => ({
  answer,
  feedback: null,
  previousFeedback: null,
  hits: [],
  round: 1,
})

function setup(ids = ['a', 'b', 'c']) {
  const prompts = ids.map(prompt)
  /** 每题一份「当前作答」，模拟真实的 attempt state。 */
  const cache = new Map<string, ProductionAttemptSnapshot>()
  const resetAttempt = vi.fn(() => cache.set(prompts[0]?.zh ?? '', snap('')))
  const restored: string[] = []
  const { result } = renderHook(() => {
    const [index, setIndex] = useState(0)
    const jump = useProductionJump({
      prompts,
      index,
      setIndex,
      snapshot: () => cache.get(prompts[index]?.zh ?? '') ?? snap(''),
      restore: (s) => {
        restored.push(s.answer)
      },
      resetAttempt,
      grading: false,
    })
    return { index, ...jump }
  })
  return { result, restored, resetAttempt, prompts, cache }
}

describe('useProductionJump：断句列表点选跳题', () => {
  it('跳到第 3 句再跳回第 1 句，会还原第 1 句的快照而不是清空', () => {
    const { result, restored, cache } = setup()
    // 第 1 句写了一半
    cache.set('句子 a', snap('half sentence'))
    act(() => {
      result.current.jumpTo(2)
    })
    expect(result.current.index).toBe(2)
    act(() => {
      result.current.jumpTo(0)
    })
    expect(result.current.index).toBe(0)
    expect(restored).toContain('half sentence')
  })

  it('跳过去的题没有快照时清空作答，不残留上一题的内容', () => {
    const { result, resetAttempt } = setup()
    act(() => {
      result.current.jumpTo(1)
    })
    expect(resetAttempt).toHaveBeenCalledTimes(1)
  })

  it('已交标记按句记（不按题号），跳着交也算', () => {
    const { result } = setup()
    act(() => {
      result.current.markDone('句子 c')
    })
    expect(result.current.doneIds.has('句子 c')).toBe(true)
    expect(result.current.doneIds.has('句子 a')).toBe(false)
  })

  it('清空后快照和已交标记都不留到下一组', () => {
    const { result } = setup()
    act(() => {
      result.current.markDone('句子 b')
    })
    act(() => {
      result.current.clear()
    })
    expect(result.current.doneIds.size).toBe(0)
  })

  it('越界题号 / 正在批改时不动', () => {
    const ids = ['a']
    const prompts = ids.map(prompt)
    const setIndex = vi.fn()
    const { result } = renderHook(() =>
      useProductionJump({
        prompts,
        index: 0,
        setIndex,
        snapshot: () => snap('x'),
        restore: () => {},
        resetAttempt: () => {},
        grading: true,
      }),
    )
    act(() => {
      result.current.jumpTo(0)
    })
    act(() => {
      result.current.jumpTo(9)
    })
    expect(setIndex).not.toHaveBeenCalled()
  })
})
