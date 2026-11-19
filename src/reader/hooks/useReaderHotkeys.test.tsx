// @vitest-environment jsdom
import { renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { resetHotkeysForTest } from '../hotkeys'
import { useReaderHotkeys } from './useReaderHotkeys'

type Props = Parameters<typeof useReaderHotkeys>[0]

afterEach(() => resetHotkeysForTest())

const press = (key: string, target?: EventTarget) => {
  ;(target ?? window).dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }))
}

/** 朗读栈假实现；`playing(text)` = 正在读某句（loading 也算在读）。 */
function speech(over: Partial<Props['speech']> = {}): Props['speech'] {
  return {
    speak: vi.fn(),
    stopReadAll: vi.fn(),
    ttsState: 'idle',
    nowPlaying: null,
    readingAll: false,
    ...over,
  }
}

const playing = (text: string, state: 'loading' | 'playing' = 'playing'): Props['speech'] =>
  speech({ ttsState: state, nowPlaying: { text, wordTimings: [], ms: 0 } })

function render(speechApi: Props['speech'] = speech(), sentenceText: string | null = 'A quiet morning.') {
  const props: Props = {
    services: { studyQueue: null, quizQueue: null, quickQueue: null },
    panels: { speedReadOpen: false },
    dictQueue: null,
    langOpen: false,
    listenOpen: false,
    backOpen: false,
    toggleVocabRef: { current: vi.fn() },
    navVocabRef: { current: vi.fn() },
    speech: speechApi,
    sentenceText,
  }
  renderHook((p: Props) => useReaderHotkeys(p), { initialProps: props })
  return speechApi
}

/**
 * 「停完再按 → 从头读」由 `core/speakToggle` 的单测钉住；
 * 这里只钉 R 键接到「读本句」同一个 speak / stopReadAll 上，以及各个不抢键的场景。
 */
describe('useReaderHotkeys：R 读选中句', () => {
  it('空闲时按 R → 用「读本句」的 speak 读选中句', () => {
    const api = render()
    press('r')
    expect(api.speak).toHaveBeenCalledWith('A quiet morning.')
    expect(api.stopReadAll).not.toHaveBeenCalled()
  })

  it('同一句正在读 → 停止', () => {
    const api = render(playing('A quiet morning.'))
    press('R')
    expect(api.stopReadAll).toHaveBeenCalledTimes(1)
    expect(api.speak).not.toHaveBeenCalled()
  })

  it('同一句正在合成 → 也停止', () => {
    const api = render(playing('A quiet morning.', 'loading'))
    press('r')
    expect(api.stopReadAll).toHaveBeenCalledTimes(1)
  })

  it('正在读别的句子 → 改读选中句', () => {
    const api = render(playing('Another sentence.'))
    press('r')
    expect(api.speak).toHaveBeenCalledWith('A quiet morning.')
    expect(api.stopReadAll).not.toHaveBeenCalled()
  })

  it('没有选中句 → 不动当前播放', () => {
    const api = render(speech(), null)
    press('r')
    expect(api.speak).not.toHaveBeenCalled()
    expect(api.stopReadAll).not.toHaveBeenCalled()
  })

  it('输入框里按 R 不抢（照常打字）', () => {
    const api = render()
    press('r', document.createElement('input'))
    expect(api.speak).not.toHaveBeenCalled()
  })
})
