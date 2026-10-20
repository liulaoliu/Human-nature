// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, render } from '@testing-library/react'
import { useSpeaking } from './useSpeaking'
import { sentenceFixture } from '../../core/testFixtures'

/**
 * 朗读 hook 的接线：服务端音频起播/结束、失败回退通知、卸载停声。
 * 真实 TTS 音频属于浏览器/服务端能力（见 docs/TESTING.md §4 人工用例），这里用假 Audio + 假 fetch 钉接线。
 */
let api: ReturnType<typeof useSpeaking> | null = null
const onFallback = vi.fn()

const doc = { sentences: [sentenceFixture('s1', 'Hello world.')] }

class FakeAudio {
  static instances: FakeAudio[] = []
  src = ''
  currentTime = 0
  playbackRate = 1
  preload = ''
  onended: (() => void) | null = null
  onerror: (() => void) | null = null
  onplaying: (() => void) | null = null
  ontimeupdate: (() => void) | null = null
  onloadedmetadata: (() => void) | null = null
  play = vi.fn(async () => {})
  pause = vi.fn()
  constructor() {
    FakeAudio.instances.push(this)
  }
}

function Harness({
  selectedId = null,
  sentences = doc.sentences,
  voice,
}: {
  selectedId?: string | null
  sentences?: typeof doc.sentences
  voice?: string
}) {
  api = useSpeaking({ doc: { sentences }, selectedId, voice, onFallback })
  return null
}

beforeEach(() => {
  FakeAudio.instances = []
  api = null
  vi.clearAllMocks()
  vi.stubGlobal('Audio', FakeAudio)
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({ ok: true, json: async () => [{ part: 'Hello', start: 0, end: 300 }, { part: 'world', start: 300, end: 600 }] })),
  )
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('useSpeaking：起播与结束', () => {
  it('初始态：空闲、未连播', () => {
    render(<Harness />)
    expect(api!.ttsState).toBe('idle')
    expect(api!.readingAll).toBe(false)
    expect(api!.nowPlaying).toBeNull()
  })

  it('speak：加载服务端音频、取逐词时间戳，playing/ended 跟着状态走', async () => {
    render(<Harness />)
    act(() => api!.speak('Hello world.'))
    const audio = FakeAudio.instances[0]
    expect(audio.src).toContain('/api/tts?')
    expect(audio.play).toHaveBeenCalledTimes(1)
    expect(api!.ttsState).toBe('loading')
    expect(api!.nowPlaying?.text).toBe('Hello world.')

    await act(async () => {
      await Promise.resolve()
    })
    expect(api!.nowPlaying?.wordTimings).toHaveLength(2)

    act(() => audio.onplaying?.())
    expect(api!.ttsState).toBe('playing')

    act(() => audio.onended?.())
    expect(api!.ttsState).toBe('idle')
    expect(api!.nowPlaying).toBeNull()
  })

  it('服务端起播失败：通知回退（server），不静默', async () => {
    render(<Harness />)
    act(() => api!.speak('Hello world.'))
    const audio = FakeAudio.instances[0]
    await act(async () => {
      audio.onerror?.()
      await Promise.resolve()
    })
    expect(onFallback).toHaveBeenCalledWith('server')
  })

  it('卸载时停声', () => {
    const { unmount } = render(<Harness />)
    act(() => api!.speak('Hello world.'))
    const audio = FakeAudio.instances[0]
    unmount()
    expect(audio.pause).toHaveBeenCalled()
  })
})

describe('useSpeaking：连播与预热', () => {
  it('没有句子时 startReadAll 不会进入连播态', () => {
    render(<Harness sentences={[]} />)
    act(() => api!.startReadAll())
    expect(api!.readingAll).toBe(false)
  })

  it('warmTimings / warmTexts 会请求服务端（HEAD 与 words）', async () => {
    render(<Harness />)
    act(() => {
      api!.warmTexts(['A sentence.'])
      api!.warmTimings(['Another sentence.'])
    })
    await act(async () => {
      await Promise.resolve()
    })
    const calls = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls.map((c) => String(c[0]))
    expect(calls.some((u) => u.includes('/api/tts?') && u.includes('A%20sentence.'))).toBe(true)
    expect(calls.some((u) => u.includes('/api/tts/words?'))).toBe(true)
  })

  it('离线音色：点词从该词起播（截后缀），不请求时间戳', () => {
    render(<Harness voice="local:piper-us" />)
    act(() => api!.speakFromWord('Hello world.', 1))
    const audio = FakeAudio.instances[0]
    expect(decodeURIComponent(audio.src)).toContain('text=world.')
    expect(fetch).not.toHaveBeenCalled()
    act(() => audio.onended?.())
    expect(api!.ttsState).toBe('idle')
  })

  it('离线音色：词区间只合成这一段，播完回到 idle（不会整句卡住）', () => {
    render(<Harness voice="local:piper-us" />)
    act(() => api!.speakRange('Hello world again.', 1, 1))
    const audio = FakeAudio.instances[0]
    expect(decodeURIComponent(audio.src)).toContain('text=world')
    expect(decodeURIComponent(audio.src)).not.toContain('again')
    expect(fetch).not.toHaveBeenCalled()
    act(() => audio.onended?.())
    expect(api!.ttsState).toBe('idle')
  })
})
