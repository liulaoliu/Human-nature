import { describe, it, expect } from 'vitest'
import { blob, makeStore } from './sessionDoubles'

/**
 * SessionStore 加载 / 粒度 / 导航（切块与位置）。
 * 假播放器 / 假录音器 / 假录音仓在 `sessionDoubles`（四个文件共用）。
 */
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

