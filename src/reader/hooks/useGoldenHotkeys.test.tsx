// @vitest-environment jsdom
import { renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { resetHotkeysForTest } from '../hotkeys'
import { useGoldenHotkeys, type GoldenHotkeyActions, type GoldenHotkeyContext } from './useGoldenHotkeys'

afterEach(() => resetHotkeysForTest())

const press = (key: string, init: KeyboardEventInit = {}, target?: EventTarget) => {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, ...init })
  ;(target ?? window).dispatchEvent(event)
}

const ctx = (over: Partial<GoldenHotkeyContext> = {}): GoldenHotkeyContext => ({
  open: true,
  view: 'drill',
  phase: 'fill',
  hasCloze: true,
  hasAssembly: true,
  fillCorrect: null,
  fillRoundPassed: false,
  assembleChecked: null,
  assembleOrderLength: 0,
  assembleTargetCount: 2,
  recallChecked: false,
  ...over,
})

function actions(over: Partial<GoldenHotkeyActions> = {}): GoldenHotkeyActions {
  return {
    close: vi.fn(),
    startDrill: vi.fn(),
    setView: vi.fn(),
    setPhase: vi.fn(),
    beginFill: vi.fn(),
    checkFill: vi.fn(),
    nextFillRound: vi.fn(),
    beginAssemble: vi.fn(),
    checkAssemble: vi.fn(),
    markSummary: vi.fn(),
    nextSentence: vi.fn(),
    prevSentence: vi.fn(),
    restartSentence: vi.fn(),
    revealRecall: vi.fn(),
    checkRecall: vi.fn(),
    nextRecall: vi.fn(),
    restartRecallSentence: vi.fn(),
    speakCurrent: vi.fn(),
    ...over,
  }
}

describe('useGoldenHotkeys', () => {
  it('填空 Enter 提交；填对后再 Enter 进拼句；X 重来', () => {
    const a = actions()
    const { rerender } = renderHook(({ c }) => useGoldenHotkeys(c, a), { initialProps: { c: ctx() } })
    press('Enter')
    expect(a.checkFill).toHaveBeenCalledTimes(1)
    rerender({ c: ctx({ fillRoundPassed: true }) })
    press('Enter')
    expect(a.nextFillRound).toHaveBeenCalledTimes(1)
    rerender({ c: ctx({ fillCorrect: true }) })
    press('Enter')
    expect(a.beginAssemble).toHaveBeenCalledTimes(1)
    press('x')
    expect(a.restartSentence).toHaveBeenCalledTimes(1)
  })

  it('拼句 Enter 提交；S 只在小结可看时生效；X 重来', () => {
    const a = actions()
    const { rerender } = renderHook(({ c }) => useGoldenHotkeys(c, a), {
      initialProps: { c: ctx({ phase: 'assemble', assembleOrderLength: 2, assembleTargetCount: 2 }) },
    })
    press('Enter')
    expect(a.checkAssemble).toHaveBeenCalledTimes(1)
    press('s')
    expect(a.markSummary).not.toHaveBeenCalled()
    rerender({ c: ctx({ phase: 'assemble', assembleChecked: true }) })
    press('s')
    expect(a.markSummary).toHaveBeenCalledTimes(1)
    press('x')
    expect(a.beginAssemble).toHaveBeenCalledTimes(1)
  })

  it('逆向默写 Ctrl+Enter 提交；输入框里普通 Enter 不抢；H 看答案', () => {
    const a = actions()
    renderHook(() => useGoldenHotkeys(ctx({ view: 'recall' }), a))
    const textarea = document.createElement('textarea')
    document.body.appendChild(textarea)
    press('Enter', {}, textarea)
    expect(a.checkRecall).not.toHaveBeenCalled()
    press('Enter', { ctrlKey: true }, textarea)
    expect(a.checkRecall).toHaveBeenCalledTimes(1)
    press('h', {}, textarea)
    expect(a.revealRecall).not.toHaveBeenCalled()
    press('h')
    expect(a.revealRecall).toHaveBeenCalledTimes(1)
    textarea.remove()
  })

  it('Esc 退出；关闭时不响应', () => {
    const a = actions()
    const { rerender } = renderHook(({ c }) => useGoldenHotkeys(c, a), { initialProps: { c: ctx() } })
    press('Escape')
    expect(a.close).toHaveBeenCalledTimes(1)
    rerender({ c: ctx({ open: false }) })
    press('Enter')
    expect(a.checkFill).not.toHaveBeenCalled()
  })
})
