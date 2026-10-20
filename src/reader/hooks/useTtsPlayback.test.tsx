// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, render } from '@testing-library/react'
import { useTtsPlayback } from './useTtsPlayback'
import { sentenceFixture } from '../../core/testFixtures'

/**
 * 播放层：时间戳缓存后的点词 seek / 词区间停止、整篇串联、卸载停声。
 * 真实音频属于浏览器能力（docs/TESTING.md §4），这里用假 Audio 钉接线。
 */
let api: ReturnType<typeof useTtsPlayback> | null = null
const onFallback = vi.fn()

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

function Harness({ voice = 'edge-en-us' }: { voice?: string }) {
  api = useTtsPlayback({ voice, onFallback })
  return null
}

beforeEach(() => {
  FakeAudio.instances = []
  api = null
  vi.clearAllMocks()
  vi.stubGlobal('Audio', FakeAudio)
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({
      ok: true,
      json: async () => [
        { part: 'Hello', start: 0, end: 300 },
        { part: 'world', start: 300, end: 600 },
      ],
    })),
  )
})

afterEach(() => {
  vi.unstubAllGlobals()
})

/** 先把一句播一次，把逐词时间戳放进缓存。 */
async function warmCache() {
  render(<Harness />)
  act(() => api!.speak('Hello world.'))
  await act(async () => {
    await Promise.resolve()
  })
  expect(api!.nowPlaying?.wordTimings).toHaveLength(2)
  return FakeAudio.instances[0]
}

describe('useTtsPlayback：逐词跳播', () => {
  it('有缓存时间戳：点词同步 seek 到该词起点', async () => {
    const audio = await warmCache()
    act(() => api!.speakFromWord('Hello world.', 1))
    act(() => audio.onloadedmetadata?.())
    expect(audio.currentTime).toBeCloseTo(0.3)
  })

  it('有缓存时间戳：词区间播到结束点就停，回到 idle', async () => {
    const audio = await warmCache()
    act(() => api!.speakRange('Hello world.', 0, 0))
    act(() => {
      audio.currentTime = 0.3
      audio.ontimeupdate?.()
    })
    expect(audio.pause).toHaveBeenCalled()
    expect(api!.ttsState).toBe('idle')
    expect(api!.nowPlaying).toBeNull()
  })
})

describe('useTtsPlayback：整篇连播', () => {
  it('逐句播完自动接下一句，最后回到未连播', () => {
    render(<Harness />)
    const sentences = [sentenceFixture('s1', 'First.'), sentenceFixture('s2', 'Second.')]
    act(() => api!.startReadAll(sentences))
    const audio = FakeAudio.instances[0]
    expect(decodeURIComponent(audio.src)).toContain('text=First.')
    expect(api!.readingAll).toBe(true)

    act(() => audio.onended?.())
    expect(decodeURIComponent(audio.src)).toContain('text=Second.')

    act(() => audio.onended?.())
    expect(api!.readingAll).toBe(false)
    expect(api!.ttsState).toBe('idle')
  })
})

describe('useTtsPlayback：失败与清洁', () => {
  it('服务端出错：回退通知只发一次，之后临时降级走浏览器语音', async () => {
    render(<Harness />)
    act(() => api!.speak('Hello world.'))
    const audio = FakeAudio.instances[0]
    await act(async () => {
      audio.onerror?.()
      await Promise.resolve()
    })
    expect(onFallback).toHaveBeenCalledWith('server')

    act(() => api!.speak('Hello again.'))
    // 降级期内不再重新拉服务端音频（浏览器语音兜底路径）
    expect(decodeURIComponent(audio.src)).not.toContain('again')
  })

  it('卸载时停声', () => {
    const { unmount } = render(<Harness />)
    act(() => api!.speak('Hello world.'))
    const audio = FakeAudio.instances[0]
    unmount()
    expect(audio.pause).toHaveBeenCalled()
  })
})
