import { describe, it, expect } from 'vitest'
import { PlaybackController, type PlaybackHost } from './playbackController'
import { INITIAL, type SessionState } from './sessionConfig'
import { FakePlayer } from './sessionDoubles'

/**
 * 播放控制器的单测：重点是「暂停再播要接着播」「切块要作废暂停点」
 * 「连续跟读开着时空格整轮交给 CycleRunner」这三条状态契约。
 */
function makeHost(chunks = [{ index: 0, start: 0, end: 2 }, { index: 1, start: 2, end: 5 }]) {
  const player = new FakePlayer()
  const calls: string[] = []
  const box = {
    state: { ...INITIAL, status: 'ready' as const, fileName: 'a.mp3', chunks, current: 0 } as SessionState,
  }
  let cycleRuns = 0
  const host: PlaybackHost = {
    state: () => box.state,
    set: (patch) => {
      box.state = { ...box.state, ...patch }
    },
    chunk: () => box.state.chunks[box.state.current] ?? null,
    player,
    stopAb: () => calls.push('stopAb'),
    abortCycle: () => calls.push('abortCycle'),
    runAutoCycle: async () => {
      cycleRuns++
    },
  }
  return {
    host,
    player,
    calls,
    box,
    cycleRuns: () => cycleRuns,
  }
}

describe('PlaybackController', () => {
  it('select 越界不生效，正常换块会清暂停点', () => {
    const { host, box } = makeHost()
    const c = new PlaybackController(host)
    c.select(-1)
    c.select(9)
    expect(box.state.current).toBe(0)

    box.state = { ...box.state, pausedChunk: 0 }
    c.select(1)
    expect(box.state.current).toBe(1)
    expect(box.state.pausedChunk).toBeNull()
  })

  it('连续跟读在跑时换块会中止那一轮', () => {
    const { host, calls, box } = makeHost()
    box.state = { ...box.state, cycleStep: 'rec' }
    new PlaybackController(host).select(1)
    expect(calls).toContain('abortCycle')
  })

  it('playChunk 从块头播，结束后把 playing 收回', async () => {
    const { host, player, box } = makeHost()
    const c = new PlaybackController(host)
    await c.playChunk()
    expect(player.calls).toContain('ref:0.00-2.00@1')
    expect(box.state.playing).toBe(false)
  })

  it('同一块暂停过就从暂停处接着播', async () => {
    const { host, player, box } = makeHost()
    const c = new PlaybackController(host)
    await c.playChunk()
    // 模拟「播到 1.0s 被暂停」
    player.position = 1
    box.state = { ...box.state, pausedChunk: 0 }
    await c.playChunk()
    expect(player.calls.at(-1)).toBe('ref:1.00-2.00@1')
  })

  it('pause 点在块尾附近时不续播（回到块头）', async () => {
    const { host, player, box } = makeHost()
    const c = new PlaybackController(host)
    player.position = 1.95
    box.state = { ...box.state, pausedChunk: 0 }
    await c.playChunk()
    expect(player.calls.at(-1)).toBe('ref:0.00-2.00@1')
  })

  it('toggleChunkPlay：没播就播，在播就暂停并记住当前块', async () => {
    const { host, box } = makeHost()
    const c = new PlaybackController(host)
    await c.toggleChunkPlay()
    expect(box.state.playing).toBe(false) // FakePlayer 同步播完

    box.state = { ...box.state, playing: true }
    await c.toggleChunkPlay()
    expect(box.state.playing).toBe(false)
    expect(box.state.pausedChunk).toBe(0)
  })

  it('连续跟读开着时，空格整轮交给 CycleRunner，不自己播', async () => {
    const { host, player, box, cycleRuns } = makeHost()
    box.state = { ...box.state, autoCycle: true }
    await new PlaybackController(host).toggleChunkPlay()
    expect(cycleRuns()).toBe(1)
    expect(player.calls).not.toContain('ref:0.00-2.00@1')
  })

  it('playWhole 清掉暂停点；auditionRange 不碰状态', async () => {
    const { host, player, box } = makeHost()
    const c = new PlaybackController(host)
    box.state = { ...box.state, pausedChunk: 1 }
    await c.playWhole()
    expect(box.state.pausedChunk).toBeNull()
    expect(player.calls).toContain('all@1')

    const before = { ...box.state }
    await c.auditionRange(0.5, 1.2)
    expect(box.state).toEqual(before)
  })

  it('next/prev 切块并接着播；已在边界上不重放', async () => {
    const { host, player, box } = makeHost()
    const c = new PlaybackController(host)
    c.next()
    await new Promise((r) => setTimeout(r, 0))
    expect(box.state.current).toBe(1)
    expect(player.calls.some((x) => x.startsWith('ref:2.00-5.00'))).toBe(true)

    const played = player.calls.length
    c.next() // 已在最后一块
    await new Promise((r) => setTimeout(r, 0))
    expect(player.calls.length).toBe(played)
  })

  it('录音时只切块不放音', async () => {
    const { host, player, box } = makeHost()
    box.state = { ...box.state, recording: true }
    new PlaybackController(host).next()
    await new Promise((r) => setTimeout(r, 0))
    expect(box.state.current).toBe(1)
    expect(player.calls.some((x) => x.startsWith('ref:'))).toBe(false)
  })
})
