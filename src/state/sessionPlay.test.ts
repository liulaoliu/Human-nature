import { describe, it, expect, vi } from 'vitest'
import { blob, makeStore } from './sessionDoubles'

/**
 * SessionStore 播放（含空格暂停 / 续播 / 切块直接播）。
 * 假播放器 / 假录音器 / 假录音仓在 `sessionDoubles`（四个文件共用）。
 */
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

