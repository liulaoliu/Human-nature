// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, renderHook } from '@testing-library/react'
import { installFakeStorage } from '../testStorage'
import { sentenceFixture } from '../../core/testFixtures'
import { speedCursorKey } from '../../core/speedRead'
import { articleKey } from '../../core/docSignature'
import { resetHotkeysForTest } from '../hotkeys'
import { useSpeedReadSession, type UseSpeedReadSessionOptions } from './useSpeedReadSession'

/**
 * 速读会话状态机：游标恢复、读→揭示→下一句、超时拷打、翻句与结算。
 * 渲染/快捷键在 `SpeedReadPanel.test.tsx`，这里只钉状态推进与持久化。
 */
const sentences = [sentenceFixture('s1', 'Run fast.'), sentenceFixture('s2', 'Walk slow.')]
const keyFor = (ss = sentences) => articleKey('doc:1', ss)

let restoreStorage: () => void = () => {}

function options(over: Partial<UseSpeedReadSessionOptions> = {}): UseSpeedReadSessionOptions {
  return {
    sentences,
    docKey: keyFor(),
    onClose: vi.fn(),
    onFinishRead: vi.fn(),
    langEditorOpen: false,
    onToggleVocabMode: vi.fn(),
    ...over,
  }
}

/** 游标键 = articleKey（标识 + 正文签名）：正文不同，键就不同。 */
const KEY = speedCursorKey(keyFor())
const cursor = (ss = sentences) => Number(localStorage.getItem(speedCursorKey(keyFor(ss))))

beforeEach(() => {
  restoreStorage = installFakeStorage()
  resetHotkeysForTest()
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
    localStorage.setItem(KEY, '1')
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
    const { result } = renderHook(() =>
      useSpeedReadSession(options({ sentences: [], docKey: keyFor([]), onFinishRead })),
    )
    expect(result.current.done).toBe(true)
    act(() => result.current.advance())
    expect(result.current.index).toBe(0)
    expect(onFinishRead).toHaveBeenCalledTimes(1)
  })
})

describe('useSpeedReadSession：数字 1 选词模式', () => {
  it('主键盘 1 切换；输入框里 / 带修饰键时不抢', () => {
    const onToggleVocabMode = vi.fn()
    const { result } = renderHook(() => useSpeedReadSession(options({ onToggleVocabMode })))

    act(() => {
      fireEvent.keyDown(window, { key: '1', code: 'Digit1' })
    })
    expect(onToggleVocabMode).toHaveBeenCalledTimes(1)

    const input = document.createElement('input')
    document.body.appendChild(input)
    act(() => {
      fireEvent.keyDown(input, { key: '1', code: 'Digit1', bubbles: true })
    })
    expect(onToggleVocabMode).toHaveBeenCalledTimes(1)

    act(() => {
      fireEvent.keyDown(window, { key: '1', code: 'Digit1', ctrlKey: true })
    })
    expect(onToggleVocabMode).toHaveBeenCalledTimes(1)
    input.remove()
    expect(result.current.sentence?.id).toBe('s1')
  })
})

describe('useSpeedReadSession：退出（Esc）与游标清零', () => {
  it('停在最后一句就退出 → 游标清零，下次从第一句开始', () => {
    const onClose = vi.fn()
    const { result } = renderHook(() => useSpeedReadSession(options({ onClose })))
    act(() => result.current.go(1))
    expect(result.current.index).toBe(1)
    expect(cursor()).toBe(1)

    act(() => {
      fireEvent.keyDown(window, { key: 'Escape' })
    })
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(cursor()).toBe(0)
  })

  it('读完（推到结尾）再退出也是 0', () => {
    const onClose = vi.fn()
    const { result } = renderHook(() => useSpeedReadSession(options({ onClose })))
    act(() => result.current.go(1))
    act(() => result.current.advance())
    act(() => result.current.advance())
    expect(result.current.done).toBe(true)

    act(() => result.current.close())
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(cursor()).toBe(0)
  })

  it('读到中间就退出 → 游标留着，下次接着读', () => {
    const onClose = vi.fn()
    const three = [
      sentenceFixture('s1', 'Run fast.'),
      sentenceFixture('s2', 'Walk slow.'),
      sentenceFixture('s3', 'Jump high.'),
    ]
    const { result } = renderHook(() =>
      useSpeedReadSession(options({ onClose, sentences: three, docKey: keyFor(three) })),
    )
    act(() => result.current.go(1))
    act(() => result.current.close())
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(cursor(three)).toBe(1)
  })
})

describe('useSpeedReadSession：换篇不串进度', () => {
  it('标识相同的另一篇（正文不同）→ 从第一句开始，成绩也清空', () => {
    const { result, rerender } = renderHook((p: UseSpeedReadSessionOptions) => useSpeedReadSession(p), {
      initialProps: options(),
    })
    // 第一篇读到第二句并记一笔成绩
    act(() => result.current.advance())
    act(() => result.current.advance())
    expect(result.current.index).toBe(1)
    expect(result.current.summary.count).toBe(1)

    // 同一个 docKey、不同正文 = 另一篇
    const other = [sentenceFixture('s1', 'Other text here.'), sentenceFixture('s2', 'Another one.')]
    rerender(options({ sentences: other, docKey: keyFor(other) }))
    expect(result.current.index).toBe(0)
    expect(result.current.summary.count).toBe(0)
  })

  it('换回第一篇 → 回到它自己的位置', () => {
    const other = [sentenceFixture('s1', 'Other text here.'), sentenceFixture('s2', 'Another one.')]
    const { result, rerender } = renderHook((p: UseSpeedReadSessionOptions) => useSpeedReadSession(p), {
      initialProps: options(),
    })
    act(() => result.current.go(1))
    rerender(options({ sentences: other, docKey: keyFor(other) }))
    expect(result.current.index).toBe(0)
    rerender(options())
    expect(result.current.index).toBe(1)
  })
})
