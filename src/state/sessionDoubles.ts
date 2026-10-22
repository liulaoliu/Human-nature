/**
 * `SessionStore` 单测用的假播放器 / 假录音器 / 假录音仓。
 *
 * 单独一个文件是因为会话测试按主题拆成了四个（加载 / 播放 / 录音 / 连续跟读），
 * 每个都要用同一套假实现；各抄一份就会出现「改了一处、另三处还是老行为」。
 */

import { SessionStore } from './session'
import type { AudioPlayerPort, RecorderPort, Take, TakeRepoPort } from '../core/ports'
import { buildSignal } from '../core/testSignals'

/** 记录所有调用序列，用来断言"标准 → 我的"的顺序 */
export class FakePlayer implements AudioPlayerPort {
  calls: string[] = []
  duration = 0
  sampleRate = 0
  samples: Float32Array = new Float32Array(0)
  /** 参考音播到哪儿了。「接着播」的逻辑要读它 */
  position = 0
  /** 让 playRange 挂住不返回，模拟「正在播」（测暂停/续播用） */
  holdPlayback = false
  /** 录音回放的额外放大倍数（store.setTakeBoost 应转到这里） */
  takeBoost = 1
  private pending: (() => void) | null = null
  private paused = false
  private loaded = false

  async load() {
    this.calls.push('load')
    const s = buildSignal([
      ['speech', 0.5],
      ['silence', 0.6],
      ['speech', 0.6],
      ['silence', 0.6],
      ['speech', 0.5],
    ])
    this.samples = s.samples
    this.sampleRate = s.sampleRate
    this.duration = 2.7
    this.loaded = true
  }

  async playRange(start: number, end: number, rate: number) {
    this.calls.push(`ref:${start.toFixed(2)}-${end.toFixed(2)}@${rate}`)
    this.position = start
    this.paused = false
    if (this.holdPlayback) {
      await new Promise<void>((r) => {
        this.pending = r
      })
    }
    // 自然播完才停在末尾；被人 pause 掉的话位置就留在原处（真的 audio 元素就是这样）
    if (!this.paused) this.position = end
  }

  async playWhole(rate: number) {
    this.calls.push(`all@${rate}`)
  }

  async playTake(take: Take, rate: number) {
    this.calls.push(`take:${take.id}@${rate}`)
  }

  setTakeBoost(mult: number) {
    this.takeBoost = mult
  }

  pause() {
    this.calls.push('pause')
    this.paused = true
    // 和真实现一样：暂停会把挂着的 playRange 放掉
    this.pending?.()
    this.pending = null
  }

  release() {
    this.calls.push('release')
  }

  get isLoaded() {
    return this.loaded
  }
}

export class FakeRecorder implements RecorderPort {
  startCount = 0
  stopCount = 0
  shouldFail = false
  /** 测试注入：停录时报告的「真正在说话的区间」 */
  speechFrom?: number
  speechTo?: number
  /** 测试注入：让 start() 挂住，模拟「正在等麦克风」 */
  holdStart = false
  private releaseStart: (() => void) | null = null
  private levelCb: ((v: number) => void) | null = null

  async start() {
    if (this.shouldFail) throw new Error('麦克风被占用')
    this.startCount++
    if (this.holdStart) {
      await new Promise<void>((r) => {
        this.releaseStart = r
      })
    }
  }

  /** 放开挂住的 start() */
  resumeStart() {
    this.releaseStart?.()
    this.releaseStart = null
  }

  /** 测试用它模拟「说到 / 停下」 */
  emitLevel(v: number) {
    this.levelCb?.(v)
  }

  async stop(): Promise<{
    blob: Blob
    mimeType: string
    durationSec: number
    speechFrom?: number
    speechTo?: number
  }> {
    this.stopCount++
    return {
      blob: new Blob(['x']),
      mimeType: 'audio/webm',
      durationSec: 3.2,
      speechFrom: this.speechFrom,
      speechTo: this.speechTo,
    }
  }

  onLevel(cb: (v: number) => void) {
    this.levelCb = cb
  }

  release() {}
}

export class FakeRepo implements TakeRepoPort {
  map = new Map<string, Take>()
  /** 测试注入：模拟配额满 */
  failSave = false
  failRemove = false
  /** 调用顺序（save / remove），用来确认「先存新的再删旧的」 */
  calls: string[] = []

  async save(t: Take) {
    if (this.failSave) throw new Error('磁盘满了')
    this.calls.push('save')
    this.map.set(t.id, t)
  }
  /** 真实现走 fileName 索引，假的也照这个语义筛 */
  async listByFile(fileName: string) {
    return [...this.map.values()].filter((t) => t.fileName === fileName)
  }
  async remove(id: string) {
    if (this.failRemove) throw new Error('删除失败')
    this.calls.push('remove')
    this.map.delete(id)
  }
  async clear() {
    this.calls.push('clear')
    this.map.clear()
  }
}

export function makeStore() {
  const player = new FakePlayer()
  const recorder = new FakeRecorder()
  const repo = new FakeRepo()
  const store = new SessionStore({
    player,
    recorder,
    repo,
    abGapMs: 0,
    cycleGapMs: 600,
  })
  return { store, player, recorder, repo }
}


/** 一个随便的音频二进制（假播放器不解码它，只当参数传） */
export const blob = new Blob(['audio'])
