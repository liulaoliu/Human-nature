// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, renderHook, waitFor } from '@testing-library/react'
import { installFakeStorage } from '../testStorage'
import { sentenceFixture } from '../../core/testFixtures'
import { resetHotkeysForTest } from '../hotkeys'
import { useRepeatSession, type UseRepeatSessionOptions } from './useRepeatSession'

/**
 * 复读会话：空格播放/循环、R 录音落库、C 连续跟读起跑、关着时不抢键盘。
 * 播放器/录音器都是假的（真实现要媒体栈），这里只钉编排顺序。
 */
const audio = vi.hoisted(() => ({
  start: vi.fn<() => Promise<void>>(),
  stop: vi.fn<() => Promise<{ blob: Blob; mimeType: string; durationSec: number }>>(),
  played: vi.fn<(take: unknown, rate: number) => Promise<void>>(),
}))

vi.mock('../../adapters/browserAudio', () => ({
  BrowserPlayer: class {
    setTakeBoost() {}
    pause() {}
    release() {}
    playTake(take: unknown, rate: number) {
      return audio.played(take, rate)
    }
  },
  BrowserRecorder: class {
    onLevel() {}
    configure() {}
    start() {
      return audio.start()
    }
    stop() {
      return audio.stop()
    }
    release() {}
  },
  listAudioInputs: async () => [],
}))

const sentences = [sentenceFixture('s1', 'Run fast.'), sentenceFixture('s2', 'Walk slow.')]

function options(over: Partial<UseRepeatSessionOptions> = {}): UseRepeatSessionOptions {
  return {
    open: true,
    sentences,
    index: 0,
    sentence: sentences[0],
    articleKey: 'doc:1',
    go: vi.fn(),
    onExit: vi.fn(),
    playSentence: vi.fn(),
    stopSpeech: vi.fn(),
    warmTexts: vi.fn(),
    langEditorOpen: false,
    ...over,
  }
}

let restoreStorage: () => void = () => {}

beforeEach(() => {
  restoreStorage = installFakeStorage()
  resetHotkeysForTest()
  audio.start.mockResolvedValue(undefined)
  audio.stop.mockResolvedValue({ blob: new Blob(['x']), mimeType: 'audio/webm', durationSec: 1 })
  audio.played.mockResolvedValue(undefined)
})

afterEach(() => {
  restoreStorage()
  vi.clearAllMocks()
  vi.restoreAllMocks()
})

describe('useRepeatSession：播放与循环', () => {
  it('空格播放当前句（带语速与结束回调）', () => {
    const playSentence = vi.fn()
    renderHook(() => useRepeatSession(options({ playSentence })))
    fireEvent.keyDown(window, { key: ' ' })
    expect(playSentence).toHaveBeenCalledWith(
      'Run fast.',
      expect.objectContaining({ rate: 1, onEnd: expect.any(Function) }),
    )
  })

  it('循环 3 遍：每次结束都重播，最后一遍停', () => {
    localStorage.setItem('reader:repeatLoop', '3')
    const playSentence = vi.fn()
    renderHook(() => useRepeatSession(options({ playSentence })))
    fireEvent.keyDown(window, { key: ' ' })
    expect(playSentence).toHaveBeenCalledTimes(1)

    for (let i = 0; i < 3; i++) {
      act(() => playSentence.mock.calls[i]![1].onEnd())
    }
    expect(playSentence).toHaveBeenCalledTimes(3)
  })

  it('复读关着时空格不抢速读的键盘', () => {
    const playSentence = vi.fn()
    renderHook(() => useRepeatSession(options({ open: false, playSentence })))
    fireEvent.keyDown(window, { key: ' ' })
    expect(playSentence).not.toHaveBeenCalled()
  })
})

describe('useRepeatSession：录音与连续跟读', () => {
  it('R 开始录音，再按 R 落库成当前句的 take', async () => {
    const { result } = renderHook(() => useRepeatSession(options()))
    fireEvent.keyDown(window, { key: 'r' })
    await waitFor(() => expect(result.current.recording).toBe(true))

    fireEvent.keyDown(window, { key: 'r' })
    await waitFor(() => expect(result.current.take?.sentenceId).toBe('s1'))
    expect(result.current.take?.sentenceText).toBe('Run fast.')
  })

  it('再录一次会覆盖同一句的旧录音（新的 createdAt）', async () => {
    let now = 1000
    vi.spyOn(Date, 'now').mockImplementation(() => now)
    const { result } = renderHook(() => useRepeatSession(options()))

    fireEvent.keyDown(window, { key: 'r' })
    await waitFor(() => expect(result.current.recording).toBe(true))
    fireEvent.keyDown(window, { key: 'r' })
    await waitFor(() => expect(result.current.take?.createdAt).toBe(1000))

    now = 2000
    fireEvent.keyDown(window, { key: 'r' })
    await waitFor(() => expect(result.current.recording).toBe(true))
    fireEvent.keyDown(window, { key: 'r' })
    await waitFor(() => expect(result.current.take?.createdAt).toBe(2000))
    // 同一句只有一条：id 不变，内容换成新的
    expect(result.current.take?.sentenceId).toBe('s1')
  })

  it('C 连续跟读：先播标准音，播完自动开录', async () => {
    const playSentence = vi.fn()
    const { result } = renderHook(() => useRepeatSession(options({ playSentence })))
    fireEvent.keyDown(window, { key: 'c' })
    expect(playSentence).toHaveBeenCalledTimes(1)
    expect(result.current.cycleOn).toBe(true)

    act(() => playSentence.mock.calls[0]![1].onEnd())
    await waitFor(() => expect(audio.start).toHaveBeenCalled())
    expect(result.current.cycleStep).toBe('rec')
  })
})
