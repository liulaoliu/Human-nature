import { afterEach, describe, expect, it, vi } from 'vitest'
import { LEVEL_PUSH_MS, LevelMeter } from './levelMeter'

afterEach(() => vi.useRealTimers())

describe('LevelMeter（电平节流上报）', () => {
  it('第一拍立刻上报', () => {
    const push = vi.fn()
    const meter = new LevelMeter(push)
    meter.accept(0.5)
    expect(push).toHaveBeenCalledWith(0.5)
  })

  it('同一时间窗口内只上报一次，尾帧补上最新值', () => {
    vi.useFakeTimers()
    vi.setSystemTime(0)
    const push = vi.fn()
    const meter = new LevelMeter(push)
    meter.accept(0.1) // 立刻发
    meter.accept(0.4) // 没到点，记住
    meter.accept(0.9) // 覆盖成最新
    expect(push).toHaveBeenCalledTimes(1)

    vi.advanceTimersByTime(LEVEL_PUSH_MS)
    expect(push).toHaveBeenLastCalledWith(0.9)
    expect(push).toHaveBeenCalledTimes(2)
  })

  it('隔得够久就直接发，不再等尾帧', () => {
    vi.useFakeTimers()
    vi.setSystemTime(0)
    const push = vi.fn()
    const meter = new LevelMeter(push)
    meter.accept(0.2)
    vi.advanceTimersByTime(LEVEL_PUSH_MS * 2)
    meter.accept(0.8)
    expect(push).toHaveBeenCalledTimes(2)
    expect(push).toHaveBeenLastCalledWith(0.8)
  })

  it('flush 立刻把待发值发出去（停录时电平表不会停在旧数字）', () => {
    vi.useFakeTimers()
    vi.setSystemTime(0)
    const push = vi.fn()
    const meter = new LevelMeter(push)
    meter.accept(0.2)
    meter.accept(0.6)
    meter.flush()
    expect(push).toHaveBeenLastCalledWith(0.6)
  })

  it('flush 之后挂着的尾帧不会再发一次（不然停录后还会写 state）', () => {
    vi.useFakeTimers()
    vi.setSystemTime(0)
    const push = vi.fn()
    const meter = new LevelMeter(push)
    meter.accept(0.2)
    meter.accept(0.6)
    meter.flush()
    const before = push.mock.calls.length
    vi.advanceTimersByTime(LEVEL_PUSH_MS * 3)
    expect(push.mock.calls.length).toBe(before)
  })

  it('resetThrottle 让下一拍立刻进 state（开始录音时）', () => {
    vi.useFakeTimers()
    vi.setSystemTime(0)
    const push = vi.fn()
    const meter = new LevelMeter(push)
    meter.accept(0.2)
    meter.accept(0.3) // 被节流
    meter.resetThrottle()
    meter.accept(0.7)
    expect(push).toHaveBeenLastCalledWith(0.7)
  })
})
