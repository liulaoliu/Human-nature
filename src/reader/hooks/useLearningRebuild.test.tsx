// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { emptyLearning, type LearningData } from '../../core/learning'
import { useLearningRebuild } from './useLearningRebuild'

function make(patch: Partial<LearningData> = {}): LearningData {
  return { ...emptyLearning(), ...patch }
}

describe('useLearningRebuild（重建并核对）', () => {
  it('一致时提示「核对一致」，并把结果留在 result 上', async () => {
    const server = make({
      activity: [{ day: '2026-10-20', counts: { vocab: 3 } }],
      kindStats: { a1: { spell: { total: 4, correct: 3 } } },
    })
    const flash = vi.fn()
    const repo = { rebuildDerived: vi.fn().mockResolvedValue(server) } as never
    const { result } = renderHook(() =>
      useLearningRebuild({ flash, repo, readLocal: () => server }),
    )

    await act(() => result.current.run())
    expect(flash).toHaveBeenCalledWith('学习记录核对一致：活动 3 次 · 答题 4 道')
    expect(result.current.result?.matched).toBe(true)
    expect(result.current.note).toBe('核对一致：活动 3 次 · 答题 4 道')
    expect(result.current.busy).toBe(false)
  })

  it('不一致时只报差异，不写本地（readLocal 只读一次）', async () => {
    const local = make({ activity: [{ day: '2026-10-20', counts: { vocab: 1 } }] })
    const server = make({ activity: [{ day: '2026-10-20', counts: { vocab: 5 } }] })
    const flash = vi.fn()
    const readLocal = vi.fn(() => local)
    const repo = { rebuildDerived: vi.fn().mockResolvedValue(server) } as never
    const { result } = renderHook(() => useLearningRebuild({ flash, repo, readLocal }))

    await act(() => result.current.run())
    expect(readLocal).toHaveBeenCalledTimes(1)
    expect(flash.mock.calls[0][0]).toContain('核对发现 1 项不一致：活动·词 本地 1 / 服务端 5')
    expect(result.current.result?.mismatched).toHaveLength(1)
  })

  it('服务不可用（返回 null）时提示，不产生结果', async () => {
    const flash = vi.fn()
    const repo = { rebuildDerived: vi.fn().mockResolvedValue(null) } as never
    const { result } = renderHook(() =>
      useLearningRebuild({ flash, repo, readLocal: () => emptyLearning() }),
    )

    await act(() => result.current.run())
    expect(flash).toHaveBeenCalledWith(expect.stringContaining('重建失败：本地存储服务不可用'))
    expect(result.current.result).toBeNull()
    expect(result.current.busy).toBe(false)
  })

  it('仓储没有 rebuildDerived 时按「做不到」处理，不抛', async () => {
    const flash = vi.fn()
    const { result } = renderHook(() =>
      useLearningRebuild({ flash, repo: {} as never, readLocal: () => emptyLearning() }),
    )
    await act(() => result.current.run())
    expect(flash).toHaveBeenCalledWith(expect.stringContaining('重建失败'))
  })

  it('请求异常：提示可见，busy 复位，可以重试', async () => {
    const flash = vi.fn()
    const err = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const rebuildDerived = vi
      .fn()
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce(emptyLearning())
    const { result } = renderHook(() =>
      useLearningRebuild({ flash, repo: { rebuildDerived } as never, readLocal: () => emptyLearning() }),
    )

    await act(() => result.current.run())
    expect(flash).toHaveBeenCalledWith(expect.stringContaining('重建失败：存储服务返回异常'))
    expect(result.current.busy).toBe(false)

    await act(() => result.current.run())
    expect(result.current.result?.matched).toBe(true)
    expect(rebuildDerived).toHaveBeenCalledTimes(2)
    err.mockRestore()
  })

  it('并发连点只发一次请求', async () => {
    let release: (v: LearningData) => void = () => {}
    const rebuildDerived = vi.fn(() => new Promise<LearningData>((r) => (release = r)))
    const flash = vi.fn()
    const { result } = renderHook(() =>
      useLearningRebuild({ flash, repo: { rebuildDerived } as never, readLocal: () => emptyLearning() }),
    )

    let first: Promise<void> = Promise.resolve()
    act(() => {
      first = result.current.run()
    })
    await act(async () => {
      await result.current.run()
    })
    expect(rebuildDerived).toHaveBeenCalledTimes(1)
    await act(async () => {
      release(emptyLearning())
      await first
    })
    expect(result.current.busy).toBe(false)
  })
})
