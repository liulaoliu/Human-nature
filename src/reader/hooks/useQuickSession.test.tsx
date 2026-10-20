// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import type { VocabLibrary } from '../../types/document'
import { vocabItem } from '../../core/testFixtures'
import { useQuickSession, type UseQuickSessionParams } from './useQuickSession'

function library(items = [vocabItem({ id: 'v1', word: 'run', lemma: 'run' })]): VocabLibrary {
  return { schemaVersion: 1, items }
}

function setup(over: Partial<UseQuickSessionParams> = {}) {
  const params: UseQuickSessionParams = {
    studyPool: [vocabItem({ id: 'v1', word: 'run', lemma: 'run' }), vocabItem({ id: 'v2', word: 'walk', lemma: 'walk' })],
    library: library(),
    persist: vi.fn(),
    markStudied: vi.fn(),
    recordActivity: vi.fn(),
    flash: vi.fn(),
    closeOthers: vi.fn(),
    ...over,
  }
  const hook = renderHook(() => useQuickSession(params))
  return { ...hook, params }
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('useQuickSession：开始 / 评分', () => {
  it('空范围 → 只提示，不开会话', () => {
    const { result, params } = setup({ studyPool: [] })
    act(() => result.current.start())
    expect(params.flash).toHaveBeenCalledWith('这个范围里没有词')
    expect(result.current.queue).toBeNull()
    expect(params.closeOthers).not.toHaveBeenCalled()
  })

  it('开始：关其它会话、按到期排序、复位进度', () => {
    const early = vocabItem({
      id: 'v1',
      word: 'run',
      lemma: 'run',
      reviewState: { ease: 2.5, due: '2020-01-01T00:00:00.000Z', interval: 1, repetitions: 1 },
    })
    const late = vocabItem({
      id: 'v2',
      word: 'walk',
      lemma: 'walk',
      reviewState: { ease: 2.5, due: '2030-01-01T00:00:00.000Z', interval: 1, repetitions: 1 },
    })
    const { result, params } = setup({ studyPool: [late, early] })
    act(() => result.current.start())
    expect(params.closeOthers).toHaveBeenCalled()
    expect(result.current.queue?.map((x) => x.id)).toEqual(['v1', 'v2'])
    expect(result.current.index).toBe(0)
    expect(result.current.revealed).toBe(false)
  })

  it('评分：走 reviewItem + 唯一写入口 persist，并记学习/活动', () => {
    const p = setup()
    act(() => p.result.current.start())
    act(() => p.result.current.grade(true))
    expect(p.params.persist).toHaveBeenCalledTimes(1)
    const next = vi.mocked(p.params.persist).mock.calls[0][0]
    expect(next.items.find((x) => x.id === 'v1')?.reviewState?.repetitions).toBeGreaterThan(0)
    expect(p.params.markStudied).toHaveBeenCalledWith('v1')
    expect(p.params.recordActivity).toHaveBeenCalledWith('vocab', 1)
    expect(p.result.current.index).toBe(1)
  })

  it('键盘：空格看释义，Esc 退出，→ 评分', () => {
    const p = setup()
    act(() => p.result.current.start())

    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }))
    })
    expect(p.result.current.revealed).toBe(true)

    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))
    })
    expect(p.params.markStudied).toHaveBeenCalledWith('v1')

    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    })
    expect(p.result.current.queue).toBeNull()
  })

  it('没有队列时快捷键不动作', () => {
    const p = setup()
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }))
    })
    expect(p.params.markStudied).not.toHaveBeenCalled()
  })
})
