import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { SessionStore } from './session'
import type { AudioPlayerPort, RecorderPort, Take, TakeRepoPort } from '../core/ports'
import { buildSignal } from '../core/testSignals'

/** 记录所有调用序列，用来断言"标准 → 我的"的顺序 */
class FakePlayer implements AudioPlayerPort {
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

class FakeRecorder implements RecorderPort {
  startCount = 0
  stopCount = 0
  shouldFail = false
  private levelCb: ((v: number) => void) | null = null

  async start() {
    if (this.shouldFail) throw new Error('麦克风被占用')
    this.startCount++
  }

  /** 测试用它模拟「说到 / 停下」 */
  emitLevel(v: number) {
    this.levelCb?.(v)
  }

  async stop() {
    this.stopCount++
    return {
      blob: new Blob(['x']),
      mimeType: 'audio/webm',
      durationSec: 3.2,
    }
  }

  onLevel(cb: (v: number) => void) {
    this.levelCb = cb
  }

  release() {}
}

class FakeRepo implements TakeRepoPort {
  map = new Map<string, Take>()

  async save(t: Take) {
    this.map.set(t.id, t)
  }
  /** 真实现走 fileName 索引，假的也照这个语义筛 */
  async listByFile(fileName: string) {
    return [...this.map.values()].filter((t) => t.fileName === fileName)
  }
  async remove(id: string) {
    this.map.delete(id)
  }
  async clear() {
    this.map.clear()
  }
}

function makeStore() {
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

const blob = new Blob(['audio'])

describe('SessionStore 加载', () => {
  it('初始状态是空的', () => {
    const { store } = makeStore()
    expect(store.getState().status).toBe('empty')
    expect(store.getState().chunks).toHaveLength(0)
  })

  it('加载后切出 3 块并把 current 归零', async () => {
    const { store } = makeStore()
    await store.load(blob, 'a.mp3')
    const s = store.getState()
    expect(s.status).toBe('ready')
    expect(s.fileName).toBe('a.mp3')
    expect(s.chunks).toHaveLength(3)
    expect(s.current).toBe(0)
    expect(s.duration).toBe(2.7)
  })

  it('每块的 index 连续且严格递增', async () => {
    const { store } = makeStore()
    await store.load(blob, 'a.mp3')
    const { chunks } = store.getState()
    chunks.forEach((c, i) => {
      expect(c.index).toBe(i)
      expect(c.end).toBeGreaterThan(c.start)
      if (i > 0) expect(c.start).toBeGreaterThanOrEqual(chunks[i - 1].end)
    })
  })

  it('解码失败时进入 error 状态并带上面试信息', async () => {
    const { store, player } = makeStore()
    player.load = async () => {
      throw new Error('这个文件不是音频')
    }
    await store.load(blob, 'x.mp3')
    expect(store.getState().status).toBe('error')
    expect(store.getState().error).toBe('这个文件不是音频')
  })

  it('并发 load 时只认最后一次的结果', async () => {
    const { store, player } = makeStore()
    const real = player.load.bind(player)
    let call = 0
    player.load = async () => {
      call++
      if (call === 1) await new Promise((r) => setTimeout(r, 20))
      else await real()
    }
    const first = store.load(blob, '慢.mp3')
    const second = store.load(blob, '快.mp3')
    await Promise.all([first, second])
    expect(store.getState().fileName).toBe('快.mp3')
  })
})

describe('SessionStore 粒度', () => {
  it('切到"短"得到更多块，切到"长"得到更少块', async () => {
    const { store } = makeStore()
    await store.load(blob, 'a.mp3')
    store.setGranularity('short')
    const short = store.getState().chunks.length
    store.setGranularity('long')
    const long = store.getState().chunks.length
    expect(short).toBeGreaterThanOrEqual(long)
  })

  it('未加载时改粒度不报错也不切块', () => {
    const { store } = makeStore()
    store.setGranularity('short')
    expect(store.getState().granularity).toBe('normal')
    expect(store.getState().chunks).toHaveLength(0)
  })

  it('改粒度后 current 不会越界', async () => {
    const { store } = makeStore()
    await store.load(blob, 'a.mp3')
    store.select(2)
    store.setGranularity('long')
    expect(store.getState().current).toBeLessThan(store.getState().chunks.length)
  })
})

describe('SessionStore 导航', () => {
  it('next / prev 在边界处停住', async () => {
    const { store } = makeStore()
    await store.load(blob, 'a.mp3')
    store.next()
    store.next()
    store.next()
    store.next()
    expect(store.getState().current).toBe(2)
    store.prev()
    store.prev()
    store.prev()
    expect(store.getState().current).toBe(0)
  })

  it('select 越界无效', async () => {
    const { store } = makeStore()
    await store.load(blob, 'a.mp3')
    store.select(99)
    expect(store.getState().current).toBe(0)
  })
})

describe('SessionStore 播放', () => {
  it('播放当前块用的是该块的时间区间和当前语速', async () => {
    const { store, player } = makeStore()
    await store.load(blob, 'a.mp3')
    player.calls.length = 0
    store.setRate(0.75)
    await store.playChunk()
    const c = store.getState().chunks[0]
    expect(player.calls).toEqual([`ref:${c.start.toFixed(2)}-${c.end.toFixed(2)}@0.75`])
  })

  it('电平进 state 有节流，但判定「说完没有」仍用原始值', async () => {
    vi.useFakeTimers()
    try {
      const { store, recorder } = makeStore()
      await store.load(blob, 'a.mp3')
      await store.setAutoCycle(true)
      void store.runAutoCycle()
      await vi.advanceTimersByTimeAsync(0) // 放标准音
      await vi.advanceTimersByTimeAsync(600) // 空档后开录
      expect(store.getState().recording).toBe(true)

      // 每 1ms 一帧 ≈ 1000fps，远超节流间隔：30 帧电平只该发出 1~2 次
      for (let i = 0; i < 30; i++) {
        recorder.emitLevel(0.5)
        vi.advanceTimersByTime(1)
      }
      expect(store.getState().level).toBe(0.5) // 有值进 state（表要动）
      expect(store.getState().recording).toBe(true)

      // 关键：判定走的是原始值。静 3 秒（>2.5 秒 hangover，<4 秒兜底上限）
      // 就该自动收工 —— 若电平被节流到没记上「说过了」，这里不会停，只能等兜底。
      recorder.emitLevel(0)
      await vi.advanceTimersByTimeAsync(3000)
      expect(store.getState().recording).toBe(false)
      expect(store.getState().takes).toHaveLength(1)
    } finally {
      vi.useRealTimers()
    }
  })

  it('停录会把电平收干净（不留挂起的节流定时器）', async () => {
    vi.useFakeTimers()
    try {
      const { store, recorder } = makeStore()
      await store.load(blob, 'a.mp3')
      await store.startRecording()
      recorder.emitLevel(0.4)
      vi.advanceTimersByTime(5) // 制造一个待发的节流帧
      await store.stopRecording()
      expect(store.getState().level).toBe(0)
    } finally {
      vi.useRealTimers()
    }
  })

  it('回放放大倍数会转给播放器', async () => {
    const { store, player } = makeStore()
    await store.load(blob, 'a.mp3')
    store.setTakeBoost(3)
    expect(player.takeBoost).toBe(3)
  })

  it('没有块时播放不炸', async () => {
    const { store, player } = makeStore()
    player.calls.length = 0
    await store.playChunk()
    expect(player.calls).toEqual([])
  })
})

describe('SessionStore 切块直接播', () => {
  /** next/prev 内部是异步播的，等一轮微任务让 playRange 落地 */
  const settle = () => new Promise((r) => setTimeout(r, 0))

  it('下一块会直接把新的一块播出来', async () => {
    const { store, player } = makeStore()
    await store.load(blob, 'a.mp3')
    player.calls.length = 0
    store.next()
    await settle()
    const c = store.getState().chunks[1]
    expect(store.getState().current).toBe(1)
    expect(player.calls).toEqual([`ref:${c.start.toFixed(2)}-${c.end.toFixed(2)}@1`])
  })

  it('上一块也一样', async () => {
    const { store, player } = makeStore()
    await store.load(blob, 'a.mp3')
    store.select(2)
    player.calls.length = 0
    store.prev()
    await settle()
    const c = store.getState().chunks[1]
    expect(store.getState().current).toBe(1)
    expect(player.calls).toEqual([`ref:${c.start.toFixed(2)}-${c.end.toFixed(2)}@1`])
  })

  it('已经在边界上时，不重放也不越界', async () => {
    const { store, player } = makeStore()
    await store.load(blob, 'a.mp3')
    store.select(0)
    player.calls.length = 0
    store.prev()
    await settle()
    expect(store.getState().current).toBe(0)
    expect(player.calls).toEqual([])

    store.select(2)
    player.calls.length = 0
    store.next()
    await settle()
    expect(store.getState().current).toBe(2)
    expect(player.calls).toEqual([])
  })

  it('录音时不放参考音（会被麦克风录进去），但块照切', async () => {
    const { store, player } = makeStore()
    await store.load(blob, 'a.mp3')
    await store.toggleRecording()
    player.calls.length = 0
    store.next()
    await settle()
    expect(store.getState().current).toBe(1)
    expect(player.calls).toEqual([])
  })

  it('列表里点某一行只切块，不自动播（点一下未必是想听）', async () => {
    const { store, player } = makeStore()
    await store.load(blob, 'a.mp3')
    player.calls.length = 0
    store.select(2)
    await settle()
    expect(store.getState().current).toBe(2)
    expect(player.calls).toEqual([])
  })
})

describe('SessionStore 播放/暂停（空格）', () => {
  const settle = () => new Promise((r) => setTimeout(r, 0))

  it('没在播就播，再按一次暂停', async () => {
    const { store, player } = makeStore()
    await store.load(blob, 'a.mp3')
    player.holdPlayback = true
    void store.toggleChunkPlay()
    await settle()
    expect(store.getState().playing).toBe(true)

    player.calls.length = 0
    await store.toggleChunkPlay()
    expect(store.getState().playing).toBe(false)
    expect(player.calls).toContain('pause')
  })

  it('暂停后按空格是「接着播」，不是从头重来', async () => {
    const { store, player } = makeStore()
    await store.load(blob, 'a.mp3')
    const c = store.getState().chunks[0]
    const mid = c.start + (c.end - c.start) / 2 // 区间正中间
    player.holdPlayback = true
    void store.toggleChunkPlay()
    await settle()

    player.position = mid
    await store.toggleChunkPlay() // 暂停

    player.holdPlayback = false
    player.calls.length = 0
    await store.toggleChunkPlay() // 接着播
    expect(player.calls[0]).toBe(`ref:${mid.toFixed(2)}-${c.end.toFixed(2)}@1`)
  })

  it('暂停位置跑到当前块外面时，宁可从头播也不错接', async () => {
    const { store, player } = makeStore()
    await store.load(blob, 'a.mp3')
    const c = store.getState().chunks[0]
    player.holdPlayback = true
    void store.toggleChunkPlay()
    await settle()
    player.position = c.end + 5 // 已经不在这块里了
    await store.toggleChunkPlay() // 暂停

    player.holdPlayback = false
    player.calls.length = 0
    await store.toggleChunkPlay()
    expect(player.calls[0]).toBe(`ref:${c.start.toFixed(2)}-${c.end.toFixed(2)}@1`)
  })

  it('播完后再按空格从头播（不算续播）', async () => {
    const { store, player } = makeStore()
    await store.load(blob, 'a.mp3')
    const c = store.getState().chunks[0]
    await store.playChunk() // 假实现里播完 position = end
    player.calls.length = 0
    await store.toggleChunkPlay()
    expect(player.calls[0]).toBe(`ref:${c.start.toFixed(2)}-${c.end.toFixed(2)}@1`)
  })

  it('换了块之后暂停点作废，不会接着上一块的位置播', async () => {
    const { store, player } = makeStore()
    await store.load(blob, 'a.mp3')
    const next = store.getState().chunks[1]
    player.holdPlayback = true
    store.select(0)
    void store.toggleChunkPlay()
    await settle()
    // 这个位置正好落在第 2 块的区间里，换块后不能被当成「接着播」
    player.position = next.start + (next.end - next.start) / 2
    await store.toggleChunkPlay() // 暂停

    store.select(1) // 换块 → 暂停点作废
    player.holdPlayback = false
    player.calls.length = 0
    await store.toggleChunkPlay()
    expect(player.calls[0]).toBe(`ref:${next.start.toFixed(2)}-${next.end.toFixed(2)}@1`)
  })

  it('播完之后 playing 会自己收回来（按钮不会一直显示暂停）', async () => {
    const { store } = makeStore()
    await store.load(blob, 'a.mp3')
    await store.playChunk()
    expect(store.getState().playing).toBe(false)
  })
})

describe('SessionStore 录音', () => {
  it('录完的录音绑定到当时的块', async () => {
    const { store, recorder } = makeStore()
    await store.load(blob, 'a.mp3')
    store.select(1)
    await store.toggleRecording()
    expect(recorder.startCount).toBe(1)
    expect(store.getState().recording).toBe(true)
    await store.toggleRecording()
    expect(recorder.stopCount).toBe(1)
    expect(store.getState().recording).toBe(false)
    expect(store.getState().takes).toHaveLength(1)
    expect(store.getState().takes[0].chunkIndex).toBe(1)
  })

  it('同一块只留最新一条录音，旧的不堆着（复读够用）', async () => {
    const { store, repo } = makeStore()
    await store.load(blob, 'a.mp3')
    let last = ''
    for (let i = 0; i < 3; i++) {
      await store.toggleRecording()
      await store.toggleRecording()
      last = store.getState().takes.at(-1)!.id
    }
    const takes = store.getState().takes
    expect(takes).toHaveLength(1)
    expect(takes[0].id).toBe(last)
    expect(repo.map.size).toBe(1) // 库里也只留这一条
  })

  it('加载时每块只留最新一条，清掉老版本堆下来的历史', async () => {
    const { store, repo } = makeStore()
    const mk = (id: string, createdAt: number) =>
      ({
        id,
        fileName: 'a.mp3',
        chunkIndex: 0,
        blob: new Blob(['x']),
        mimeType: 'audio/webm',
        durationSec: 1,
        createdAt,
      }) as Take
    await repo.save(mk('old', 1))
    await repo.save(mk('new', 2))
    await store.load(blob, 'a.mp3')
    expect(store.getState().takes.map((t) => t.id)).toEqual(['new'])
  })

  it('过短的误触录音被丢弃', async () => {
    const { store, recorder } = makeStore()
    await store.load(blob, 'a.mp3')
    recorder.stop = async () => ({ blob: new Blob(), mimeType: 'audio/webm', durationSec: 0.05 })
    await store.toggleRecording()
    await store.toggleRecording()
    expect(store.getState().takes).toHaveLength(0)
  })

  it('开麦失败时进入 error 且不进入 recording', async () => {
    const { store, recorder } = makeStore()
    await store.load(blob, 'a.mp3')
    recorder.shouldFail = true
    await store.startRecording()
    expect(store.getState().recording).toBe(false)
    expect(store.getState().error).toBe('麦克风被占用')
  })

  it('未录音时再点停止是无操作', async () => {
    const { store, recorder } = makeStore()
    await store.load(blob, 'a.mp3')
    await store.stopRecording()
    expect(recorder.stopCount).toBe(0)
  })

  it('录音开始前先暂停参考音，避免外放串音', async () => {
    const { store, player } = makeStore()
    await store.load(blob, 'a.mp3')
    player.calls.length = 0
    await store.startRecording()
    expect(player.calls).toEqual(['pause'])
  })

  it('录音记下参考音的时间区间', async () => {
    const { store } = makeStore()
    await store.load(blob, 'a.mp3')
    const c = store.getState().chunks[1]
    store.select(1)
    await store.toggleRecording()
    await store.toggleRecording()
    const t = store.getState().takes[0]
    expect(t.startSec).toBeCloseTo(c.start, 6)
    expect(t.endSec).toBeCloseTo(c.end, 6)
  })

  it('撕开前面的块后，录音按时间留在原来那一块（不串块）', async () => {
    const { store } = makeStore()
    await store.load(blob, 'a.mp3')
    store.select(2)
    await store.toggleRecording()
    await store.toggleRecording()
    expect(store.getState().takes[0].chunkIndex).toBe(2)

    const c0 = store.getState().chunks[0]
    store.select(0)
    store.splitCurrentChunk((c0.start + c0.end) / 2)

    expect(store.getState().chunks).toHaveLength(4) // 块号整体后移
    expect(store.getState().takes[0].chunkIndex).toBe(3) // 靠时间落回正确位置
    expect(store.takesFor(2)).toHaveLength(0)
    expect(store.takesFor(3)).toHaveLength(1)
  })

  it('换切块档位后录音按时间重新落块', async () => {
    const { store } = makeStore()
    await store.load(blob, 'a.mp3')
    store.select(2)
    await store.toggleRecording()
    await store.toggleRecording()
    store.setGranularity('long') // 0.6s 的间隔被并掉 → 只剩一块
    const s = store.getState()
    expect(s.chunks).toHaveLength(1)
    expect(s.takes[0].chunkIndex).toBe(0)
  })

  it('刷新（重新 load）后仍按时间挂回正确的块', async () => {
    const { store } = makeStore()
    await store.load(blob, 'a.mp3')
    store.select(2)
    await store.toggleRecording()
    await store.toggleRecording()
    store.setGranularity('long')
    await store.load(blob, 'a.mp3') // 重新从库里读一遍
    expect(store.getState().takes).toHaveLength(1)
    expect(store.getState().takes[0].chunkIndex).toBe(0)
  })

  it('老记录没有时间时沿用块号', async () => {
    const { store, repo } = makeStore()
    await repo.save({
      id: 'legacy',
      fileName: 'a.mp3',
      chunkIndex: 2,
      blob: new Blob(['x']),
      mimeType: 'audio/webm',
      durationSec: 1,
      createdAt: 1,
    })
    await store.load(blob, 'a.mp3')
    expect(store.getState().takes[0].chunkIndex).toBe(2)
  })

  it('删除录音后列表同步减少', async () => {
    const { store } = makeStore()
    await store.load(blob, 'a.mp3')
    await store.toggleRecording()
    await store.toggleRecording()
    const id = store.getState().takes[0].id
    await store.removeTake(id)
    expect(store.getState().takes).toHaveLength(0)
  })

  it('录音峰值太低会提示麦克风电平低，正常峰值不提示', async () => {
    const { store, recorder } = makeStore()
    await store.load(blob, 'a.mp3')
    await store.toggleRecording()
    recorder.emitLevel(0.01)
    await store.toggleRecording()
    expect(store.getState().lowMic).toBe(true)
    store.dismissLowMic()
    expect(store.getState().lowMic).toBe(false)

    await store.toggleRecording()
    recorder.emitLevel(0.4)
    await store.toggleRecording()
    expect(store.getState().lowMic).toBe(false)
  })

  it('「说完静音多久算结束」可调，且被夹在合理范围', async () => {
    const { store } = makeStore()
    await store.load(blob, 'a.mp3')
    expect(store.getState().hangoverMs).toBe(2500)
    store.setHangoverMs(1000)
    expect(store.getState().hangoverMs).toBe(1000)
    store.setHangoverMs(99999)
    expect(store.getState().hangoverMs).toBe(15000)
    store.setHangoverMs(1)
    expect(store.getState().hangoverMs).toBe(800)
  })
})

describe('SessionStore A/B 对比', () => {
  it('先播标准再播我的，顺序不能反', async () => {
    const { store, player } = makeStore()
    await store.load(blob, 'a.mp3')
    await store.toggleRecording()
    await store.toggleRecording()
    player.calls.length = 0

    await store.compareAB(false)

    // 忽略 pause，只看"放了什么"：ref 必须排在 take 前面
    const played = player.calls.filter((c) => c !== 'pause')
    expect(played).toHaveLength(2)
    expect(played[0]).toMatch(/^ref:/)
    expect(played[1]).toMatch(/^take:/)
  })

  it('没有录音时只播标准，不报错', async () => {
    const { store, player } = makeStore()
    await store.load(blob, 'a.mp3')
    player.calls.length = 0
    await store.compareAB(false)
    const played = player.calls.filter((c) => c !== 'pause')
    expect(played).toHaveLength(1)
    expect(played[0]).toMatch(/^ref:/)
    expect(store.getState().abPlaying).toBe(false)
  })

  it('对比结束后 abPlaying 复位', async () => {
    const { store } = makeStore()
    await store.load(blob, 'a.mp3')
    await store.compareAB(false)
    expect(store.getState().abPlaying).toBe(false)
  })

  it('stopAb 会暂停播放', async () => {
    const { store, player } = makeStore()
    await store.load(blob, 'a.mp3')
    store.stopAb() // 还没开始，应该是空操作
    expect(player.calls.filter((c) => c === 'pause')).toHaveLength(0)
  })

  it('对比过程中切句会终止循环', async () => {
    const { store, player } = makeStore()
    await store.load(blob, 'a.mp3')
    await store.toggleRecording()
    await store.toggleRecording()
    player.calls.length = 0

    const running = store.compareAB(true)
    store.next() // 循环里切句
    await running
    expect(store.getState().abPlaying).toBe(false)
  })
})

describe('SessionStore 连续跟读', () => {
  const tick = (ms = 0) => vi.advanceTimersByTimeAsync(ms)

  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('打开时先摸一下麦克风，权限不行就不打开并报错', async () => {
    const { store, recorder } = makeStore()
    await store.load(blob, 'a.mp3')
    recorder.shouldFail = true
    await store.setAutoCycle(true)
    expect(store.getState().autoCycle).toBe(false)
    expect(store.getState().error).toMatch(/麦克风打不开/)
  })

  it('打开时会先试一下麦克风（不吃权限就早点发现）', async () => {
    const { store, recorder } = makeStore()
    await store.load(blob, 'a.mp3')
    await store.setAutoCycle(true)
    expect(store.getState().autoCycle).toBe(true)
    expect(recorder.startCount).toBe(1)
    expect(recorder.stopCount).toBe(1)
  })

  it('一圈下来：标准音 → 录音 → 自动停 → 回放我的', async () => {
    const { store, player } = makeStore()
    await store.load(blob, 'a.mp3')
    await store.setAutoCycle(true)
    const c = store.getState().chunks[0]
    const ref = `ref:${c.start.toFixed(2)}-${c.end.toFixed(2)}@1`
    player.calls.length = 0

    void store.runAutoCycle()
    await tick(0)
    // 第 1 步：标准音
    expect(store.getState().cycleStep).toBe('ref')
    expect(player.calls).toContain(ref)

    // 空档之后开录
    await tick(600)
    expect(store.getState().cycleStep).toBe('rec')
    expect(store.getState().recording).toBe(true)
    expect(store.getState().autoRecordMs).toBe(4000) // 短块走兜底下限 4 秒

    // 一直没说话，走兜底：到上限自动停，录音存下来
    await tick(4200)
    expect(store.getState().recording).toBe(false)
    expect(store.getState().takes).toHaveLength(1)

    // 第 3 步：直接回放刚才那条录音，不再回头放标准音
    await tick(0)
    const mine = store.getState().takes[0]
    expect(player.calls).toContain(`take:${mine.id}@1`)
    expect(player.calls.filter((x) => x.startsWith('ref:'))).toHaveLength(1)
    expect(store.getState().cycleStep).toBe('idle')
  })

  it('开着连续跟读时，下一块直接跑一整圈（复用空格那条路）', async () => {
    const { store, player, recorder } = makeStore()
    await store.load(blob, 'a.mp3')
    await store.setAutoCycle(true)
    recorder.startCount = 0
    player.calls.length = 0

    store.next()
    await tick(0)

    expect(store.getState().current).toBe(1)
    const c = store.getState().chunks[1]
    expect(player.calls).toContain(`ref:${c.start.toFixed(2)}-${c.end.toFixed(2)}@1`)
    expect(store.getState().cycleStep).toBe('ref')

    store.abortCycle()
    await tick(5000)
  })

  it('录音中按空格 = 我读完了，不用等自动停', async () => {
    const { store, player } = makeStore()
    await store.load(blob, 'a.mp3')
    await store.setAutoCycle(true)
    player.calls.length = 0
    void store.runAutoCycle()
    await tick(0)
    await tick(600)
    expect(store.getState().recording).toBe(true)

    await store.runAutoCycle() // 提前结束
    expect(store.getState().recording).toBe(false)
    expect(store.getState().takes).toHaveLength(1)
    await tick(0)
    expect(player.calls.filter((x) => x.startsWith('take:'))).toHaveLength(1)
    expect(store.getState().cycleStep).toBe('idle')
  })

  it('放标准音的中途按空格 = 中止，不会开始录音', async () => {
    const { store, recorder } = makeStore()
    await store.load(blob, 'a.mp3')
    await store.setAutoCycle(true)
    recorder.startCount = 0
    void store.runAutoCycle()
    await tick(0)
    expect(store.getState().cycleStep).toBe('ref')

    await store.runAutoCycle() // 中止
    expect(store.getState().cycleStep).toBe('idle')
    await tick(5000)
    expect(recorder.startCount).toBe(0)
    expect(store.getState().recording).toBe(false)
    expect(store.getState().takes).toHaveLength(0)
  })

  it('关掉之后空格回到「播放/暂停」，不再跑整圈', async () => {
    const { store, recorder } = makeStore()
    await store.load(blob, 'a.mp3')
    await store.setAutoCycle(true)
    await store.setAutoCycle(false)
    recorder.startCount = 0
    await store.toggleChunkPlay()
    expect(store.getState().playing).toBe(false) // 播完就收回，没进录音
    await tick(5000)
    expect(recorder.startCount).toBe(0)
  })

  it('跟读录音中按 R = 我读完了：停录并回放', async () => {
    const { store, player } = makeStore()
    await store.load(blob, 'a.mp3')
    await store.setAutoCycle(true)
    void store.runAutoCycle()
    await tick(0)
    await tick(600)
    expect(store.getState().recording).toBe(true)

    player.calls.length = 0
    await store.toggleRecording() // R 提前收尾
    expect(store.getState().recording).toBe(false)
    expect(store.getState().takes).toHaveLength(1)
    const mine = store.getState().takes[0]
    expect(player.calls).toContain(`take:${mine.id}@1`)
    expect(store.getState().cycleStep).toBe('idle')
  })

  it('手动录音停录后自动回放刚录的那条', async () => {
    const { store, player } = makeStore()
    await store.load(blob, 'a.mp3')
    await store.toggleRecording() // 开录
    expect(store.getState().recording).toBe(true)

    player.calls.length = 0
    await store.toggleRecording() // 停录
    expect(store.getState().recording).toBe(false)
    const mine = store.getState().takes[0]
    expect(player.calls).toContain(`take:${mine.id}@1`)
  })

  it('太短的误触录音既不保存也不回放', async () => {
    const { store, recorder, player } = makeStore()
    await store.load(blob, 'a.mp3')
    recorder.stop = async () => ({ blob: new Blob(), mimeType: 'audio/webm', durationSec: 0.05 })
    await store.toggleRecording()
    player.calls.length = 0
    await store.toggleRecording()
    expect(store.getState().takes).toHaveLength(0)
    expect(player.calls.some((c) => c.startsWith('take:'))).toBe(false)
  })

  it('说完停下就自动结束，不用等兜底时长', async () => {
    const { store, recorder } = makeStore()
    await store.load(blob, 'a.mp3')
    await store.setAutoCycle(true)
    void store.runAutoCycle()
    await tick(0)
    await tick(600)
    expect(store.getState().recording).toBe(true)

    recorder.emitLevel(0.5) // 说了一句
    await tick(500)
    expect(store.getState().recording).toBe(true) // 静半秒还不够
    await tick(2200) // 累计 2.7 秒 > 2.5 秒默认
    expect(store.getState().recording).toBe(false)
    expect(store.getState().takes).toHaveLength(1)
  })

  it('小声说话也算「在说」：电平低但高于底噪，不会被提前掐断', async () => {
    const { store, recorder } = makeStore()
    await store.load(blob, 'a.mp3')
    await store.setAutoCycle(true)
    void store.runAutoCycle()
    await tick(0)
    await tick(600)
    expect(store.getState().recording).toBe(true)

    // 0.03 是「小声音」：固定阈值时代（0.06）会被当成静音，两秒后就误停
    for (let i = 0; i < 15; i++) {
      recorder.emitLevel(0.03)
      await tick(200)
    }
    expect(store.getState().recording).toBe(true) // 3 秒了还在录
    store.abortCycle()
  })

  it('小声说完停下，照样会收工（自适应阈值不会永不触发）', async () => {
    const { store, recorder } = makeStore()
    await store.load(blob, 'a.mp3')
    await store.setAutoCycle(true)
    void store.runAutoCycle()
    await tick(0)
    await tick(600)
    recorder.emitLevel(0.03)
    await tick(2700)
    expect(store.getState().recording).toBe(false)
    expect(store.getState().takes).toHaveLength(1)
  })

  it('句子中间的短停顿不会被当成「读完了」', async () => {
    const { store, recorder } = makeStore()
    await store.load(blob, 'a.mp3')
    await store.setAutoCycle(true)
    void store.runAutoCycle()
    await tick(0)
    await tick(600)

    recorder.emitLevel(0.5)
    await tick(1000)
    recorder.emitLevel(0.5) // 又开口了
    await tick(1000)
    expect(store.getState().recording).toBe(true) // 还在录，没被切掉
    store.abortCycle()
  })

  it('一直在说也不会无限录下去（兜底上限按录音总时长算）', async () => {
    const { store, recorder } = makeStore()
    await store.load(blob, 'a.mp3')
    await store.setAutoCycle(true)
    void store.runAutoCycle()
    await tick(0)
    await tick(600)
    const cap = store.getState().autoRecordMs

    // 每一拍都出声，静音时长永远是 0
    for (let i = 0; i < Math.ceil(cap / 200) + 6; i++) {
      recorder.emitLevel(0.5)
      await tick(200)
    }
    expect(store.getState().recording).toBe(false)
    expect(store.getState().takes).toHaveLength(1)
  })

  it('自动录音时长随块长变长（下限 3 秒）', async () => {
    const { store } = makeStore()
    await store.load(blob, 'a.mp3')
    await store.setAutoCycle(true)
    const c = store.getState().chunks[2] // 最长的块
    store.select(2)
    void store.runAutoCycle()
    await tick(0)
    await tick(600)
    const want = Math.min(90000, Math.max(4000, Math.round((c.end - c.start) * 2000 + 3000)))
    expect(store.getState().autoRecordMs).toBe(want)
    store.abortCycle()
    await tick(90000)
  })
})

describe('录音按文章隔离', () => {
  it('换到另一篇之后，看不到上一篇的录音', async () => {
    const { store } = makeStore()
    await store.load(blob, 'a.mp3')
    store.select(1)
    await store.toggleRecording() // 开录
    await store.toggleRecording() // 停录，存下一条
    expect(store.getState().takes).toHaveLength(1)
    expect(store.getState().takes[0].fileName).toBe('a.mp3')

    await store.load(blob, 'b.mp3')
    // 块号都从 0 开始，不按文章筛的话这里会显示 a.mp3 第 2 块的录音
    expect(store.getState().takes).toEqual([])
    expect(store.takesFor(1)).toEqual([])
  })

  it('换回来还在', async () => {
    const { store } = makeStore()
    await store.load(blob, 'a.mp3')
    await store.toggleRecording()
    await store.toggleRecording()
    await store.load(blob, 'b.mp3')
    await store.load(blob, 'a.mp3')
    expect(store.getState().takes).toHaveLength(1)
  })

  it('A/B 对比不会放出别的文章的录音', async () => {
    const { store, player } = makeStore()
    await store.load(blob, 'a.mp3')
    await store.toggleRecording()
    await store.toggleRecording()
    const mineA = store.getState().takes[0]

    await store.load(blob, 'b.mp3')
    player.calls.length = 0
    await store.compareAB(false)
    // b 篇没录过，对比只该有标准音，不该出现 a 篇那条录音
    expect(player.calls.some((c) => c === `take:${mineA.id}@1`)).toBe(false)
  })

  it('库里的老记录没有 fileName，会被筛掉（本来也分不清是哪篇的）', async () => {
    const { store, repo } = makeStore()
    await store.load(blob, 'a.mp3')
    // 模拟一条旧版本存下的记录
    const legacy = {
      id: 'legacy',
      chunkIndex: 0,
      blob: new Blob(['x']),
      mimeType: 'audio/webm',
      durationSec: 1,
      createdAt: 0,
    } as unknown as Take
    await repo.save(legacy)
    await store.load(blob, 'a.mp3')
    expect(store.getState().takes).toEqual([])
  })
})
