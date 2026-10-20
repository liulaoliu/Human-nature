// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { installFakeStorage } from '../testStorage'
import { sentenceFixture } from '../../core/testFixtures'
import { useSpeedReadSession, type UseSpeedReadSessionOptions } from './useSpeedReadSession'

/**
 * 速读会话状态机：游标恢复、读→揭示→下一句、超时拷打、翻句与结算。
 * 渲染/快捷键在 `SpeedReadPanel.test.tsx`，这里只钉状态推进与持久化。
 */
const sentences = [sentenceFixture('s1', 'Run fast.'), sentenceFixture('s2', 'Walk slow.')]

let restoreStorage: () => void = () => {}

function options(over: Partial<UseSpeedReadSessionOptions> = {}): UseSpeedReadSessionOptions {
  return {
    sentences,
    docKey: 'doc:1',
    onClose: vi.fn(),
    onFinishRead: vi.fn(),
    langEditorOpen: false,
    ...over,
  }
}

const cursor = () => Number(localStorage.getItem('reader:speedCursor:doc:1'))

beforeEach(() => {
  restoreStorage = installFakeStorage()
})

afterEach(() => {
  restoreStorage()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

/** 把当前句的超时读出来，进入 reveal 再进 drill。 */
function enterDrill(result: { current: ReturnType<typeof useSpeedReadSession> }) {
  act(() => {
    vi.advanceTimersByTime(3000)
  })
  act(() => result.current.advance())
  expect(result.current.phase).toBe('reveal')
  expect(result.current.slow).toBe(true)
  act(() => result.current.advance())
  expect(result.current.phase).toBe('drill')
  expect(result.current.drill).not.toBeNull()
}

describe('useSpeedReadSession：游标与推进', () => {
  it('游标从本地恢复并夹在句子范围内', () => {
    localStorage.setItem('reader:speedCursor:doc:1', '1')
    const { result } = renderHook(() => useSpeedReadSession(options()))
    expect(result.current.index).toBe(1)
    expect(result.current.sentence?.id).toBe('s2')
    expect(result.current.done).toBe(false)
  })

  it('没读懂（没超时）→ 揭示后直接下一句，游标落盘', () => {
    const { result } = renderHook(() => useSpeedReadSession(options()))
    act(() => result.current.advance())
    expect(result.current.phase).toBe('reveal')
    expect(result.current.slow).toBe(false)

    act(() => result.current.advance())
    expect(result.current.index).toBe(1)
    expect(result.current.phase).toBe('read')
    expect(cursor()).toBe(1)
  })

  it('读到结尾 → done 且 onFinishRead 只回调一次', () => {
    const onFinishRead = vi.fn()
    const { result, rerender } = renderHook((p: UseSpeedReadSessionOptions) => useSpeedReadSession(p), {
      initialProps: options({ onFinishRead }),
    })
    act(() => result.current.go(1))
    act(() => result.current.advance())
    act(() => result.current.advance())

    expect(result.current.done).toBe(true)
    expect(onFinishRead).toHaveBeenCalledTimes(1)
    // 重复渲染 / 再 advance 不再重复记账
    rerender(options({ onFinishRead }))
    act(() => result.current.advance())
    expect(onFinishRead).toHaveBeenCalledTimes(1)
  })
})

describe('useSpeedReadSession：超时拷打', () => {
  it('超时 + 自动拷打：答错停下，按空格才进下一句', () => {
    vi.useFakeTimers()
    const { result } = renderHook(() => useSpeedReadSession(options()))
    enterDrill(result)

    const drill = result.current.drill!
    const wrong = drill.options.find((o) => o !== drill.answer)!
    act(() => result.current.chooseDrill(wrong))
    expect(result.current.phase).toBe('drill-answer')
    expect(result.current.drillOk).toBe(false)

    act(() => {
      vi.advanceTimersByTime(1000)
    })
    expect(result.current.index).toBe(0)

    act(() => result.current.advance())
    expect(result.current.index).toBe(1)
  })

  it('答对 → 650ms 后自动下一句', () => {
    vi.useFakeTimers()
    const { result } = renderHook(() => useSpeedReadSession(options()))
    enterDrill(result)

    act(() => result.current.chooseDrill(result.current.drill!.answer))
    expect(result.current.drillOk).toBe(true)
    act(() => {
      vi.advanceTimersByTime(700)
    })
    expect(result.current.index).toBe(1)
    expect(result.current.phase).toBe('read')
  })
})

describe('useSpeedReadSession：翻句与重开', () => {
  it('go 夹住边界并落盘；restart 回到第一句并清零游标', () => {
    const { result } = renderHook(() => useSpeedReadSession(options()))
    act(() => result.current.go(-1))
    expect(result.current.index).toBe(0)

    act(() => result.current.go(1))
    expect(result.current.index).toBe(1)
    expect(cursor()).toBe(1)

    act(() => result.current.restart())
    expect(result.current.index).toBe(0)
    expect(result.current.phase).toBe('read')
    expect(cursor()).toBe(0)
  })

  it('空文章：直接 done，advance 不动作', () => {
    const onFinishRead = vi.fn()
    const { result } = renderHook(() => useSpeedReadSession(options({ sentences: [], onFinishRead })))
    expect(result.current.done).toBe(true)
    act(() => result.current.advance())
    expect(result.current.index).toBe(0)
    expect(onFinishRead).toHaveBeenCalledTimes(1)
  })
})
