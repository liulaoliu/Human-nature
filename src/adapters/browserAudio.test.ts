// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { BrowserPlayer } from './browserAudio'

/**
 * `BrowserPlayer` 的接线：解码取波形/时长、按区间播放、录音归一化回放、release 回收。
 * 真实播放/麦克风依赖浏览器（docs/TESTING.md §4），这里用假 Audio / 假 AudioContext 钉逻辑。
 */

class FakeAudio {
  static instances: FakeAudio[] = []
  src = ''
  currentTime = 0
  playbackRate = 1
  preload = ''
  readyState = 1
  preserved = false
  onended: (() => void) | null = null
  onloadedmetadata: (() => void) | null = null
  play = vi.fn(async () => {})
  pause = vi.fn()
  removeAttribute = vi.fn()
  constructor() {
    FakeAudio.instances.push(this)
  }
}

/** 解码出来的一小段音频：两声道，混合后应得 [0.5, 0.5]。 */
function fakeBuffer() {
  const ch0 = new Float32Array([1, 1])
  const ch1 = new Float32Array([0, 0])
  return {
    numberOfChannels: 2,
    length: 2,
    sampleRate: 8000,
    duration: 0.25,
    getChannelData: (c: number) => (c === 0 ? ch0 : ch1),
  }
}

const decodeAudioData = vi.fn(async () => fakeBuffer())
class FakeAudioContext {
  state = 'running'
  destination = {}
  decodeAudioData = decodeAudioData
  resume = vi.fn(async () => {})
}
class FakeGain {
  gain = { value: 1 }
  connect = vi.fn()
  disconnect = vi.fn()
}
class FakeAnalyser {
  fftSize = 0
  getFloatTimeDomainData = vi.fn()
  connect = vi.fn()
  disconnect = vi.fn()
}
class FakeSource {
  connect = vi.fn()
  disconnect = vi.fn()
}

const createObjectURL = vi.fn((_b: Blob) => 'blob:fake')
const revokeObjectURL = vi.fn()
const rafCallbacks: FrameRequestCallback[] = []

beforeEach(() => {
  FakeAudio.instances = []
  rafCallbacks.length = 0
  vi.clearAllMocks()
  decodeAudioData.mockImplementation(async () => fakeBuffer())
  vi.stubGlobal('Audio', FakeAudio)
  vi.stubGlobal('AudioContext', FakeAudioContext)
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
    rafCallbacks.push(cb)
    return rafCallbacks.length
  })
  vi.stubGlobal('cancelAnimationFrame', () => {})
  Object.assign(FakeAudioContext.prototype, {
    createGain: () => new FakeGain(),
    createAnalyser: () => new FakeAnalyser(),
    createMediaStreamSource: () => new FakeSource(),
  })
  Object.defineProperty(URL, 'createObjectURL', { value: createObjectURL, configurable: true, writable: true })
  Object.defineProperty(URL, 'revokeObjectURL', { value: revokeObjectURL, configurable: true, writable: true })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

const fakeBlob = (tag = 'audio') => ({ tag, arrayBuffer: async () => new ArrayBuffer(8) }) as unknown as Blob

describe('BrowserPlayer：加载与区间播放', () => {
  it('load：解码出单声道波形 / 时长 / 采样率，并挂上 object URL', async () => {
    const p = new BrowserPlayer()
    await p.load(fakeBlob())
    expect(p.duration).toBeCloseTo(0.25)
    expect(p.sampleRate).toBe(8000)
    expect(Array.from(p.samples)).toEqual([0.5, 0.5])
    expect(createObjectURL).toHaveBeenCalled()
    expect(p.position).toBe(0)
  })

  it('playRange：按 rate 播放，到 end 前 20ms 停并 resolve', async () => {
    const p = new BrowserPlayer()
    await p.load(fakeBlob())
    const el = FakeAudio.instances[0]
    let done = false
    const playing = p.playRange(1, 2, 1.5).then(() => {
      done = true
    })
    expect(el.currentTime).toBe(1)
    expect(el.playbackRate).toBe(1.5)
    expect(el.play).toHaveBeenCalled()

    el.currentTime = 1.99
    rafCallbacks[rafCallbacks.length - 1](0)
    await playing
    expect(done).toBe(true)
    expect(el.pause).toHaveBeenCalled()
  })

  it('playRange：中途 pause 也会 resolve（不会让上层永远等）', async () => {
    const p = new BrowserPlayer()
    await p.load(fakeBlob())
    let done = false
    void p.playRange(0, 2, 1).then(() => {
      done = true
    })
    p.pause()
    await Promise.resolve()
    expect(done).toBe(true)
  })
})

describe('BrowserPlayer：录音回放', () => {
  it('playTake：归一化后播完 resolve，同一录音只解码一次（LRU 复用）', async () => {
    const p = new BrowserPlayer()
    await p.load(fakeBlob()) // 建立参考响度
    const takeEl = FakeAudio.instances[1]
    const take = { id: 't1', blob: fakeBlob('take') } as never

    let done = false
    const first = p.playTake(take, 1).then(() => {
      done = true
    })
    for (let i = 0; i < 5; i++) await Promise.resolve()
    expect(takeEl.play).toHaveBeenCalledTimes(1)
    expect(done).toBe(false)
    takeEl.onended?.()
    await first
    expect(done).toBe(true)
    const decodes = decodeAudioData.mock.calls.length

    const second = p.playTake(take, 1)
    for (let i = 0; i < 5; i++) await Promise.resolve()
    takeEl.onended?.()
    await second
    expect(decodeAudioData.mock.calls.length).toBe(decodes)
  })

  it('playTake：按 speechFrom/speechTo 从说话处起播，到说话尾就停', async () => {
    const p = new BrowserPlayer()
    await p.load(fakeBlob()) // 建立参考响度
    const takeEl = FakeAudio.instances[1]
    const take = { id: 't2', blob: fakeBlob('take'), speechFrom: 0.5, speechTo: 1 } as never

    let done = false
    const playing = p.playTake(take, 1).then(() => {
      done = true
    })
    for (let i = 0; i < 5; i++) await Promise.resolve()
    expect(takeEl.currentTime).toBe(0.5) // 跳过开头静音
    expect(done).toBe(false)

    takeEl.currentTime = 1.01
    rafCallbacks[rafCallbacks.length - 1](0)
    await playing
    expect(done).toBe(true) // 说话一结束就收，不等文件放完
  })
})

describe('BrowserPlayer：release', () => {
  it('release：停声、撤销 object URL、清空波形状态', async () => {
    const p = new BrowserPlayer()
    await p.load(fakeBlob())
    p.release()
    const el = FakeAudio.instances[0]
    expect(el.pause).toHaveBeenCalled()
    expect(el.removeAttribute).toHaveBeenCalledWith('src')
    expect(revokeObjectURL).toHaveBeenCalled()
    expect(p.duration).toBe(0)
    expect(p.sampleRate).toBe(0)
    expect(p.samples).toHaveLength(0)
  })
})
