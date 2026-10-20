import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { blob, makeStore } from './sessionDoubles'

/**
 * SessionStore 连续跟读与 A/B 对比（整圈时序 / 提前收尾）。
 * 假播放器 / 假录音器 / 假录音仓在 `sessionDoubles`（四个文件共用）。
 */
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

  it('开麦尚未返回时中止：start 回来后会立刻停录，不把麦克风留在录音态', async () => {
    const { store, recorder } = makeStore()
    await store.load(blob, 'a.mp3')
    await store.setAutoCycle(true)

    recorder.holdStart = true
    // 这一轮即使停了也不该保存（模拟刚开麦就被中止）
    recorder.stop = async () => ({ blob: new Blob(), mimeType: 'audio/webm', durationSec: 0.05 })
    const running = store.runAutoCycle()
    await tick(0)
    await tick(600) // 已经进到 startRecording，但 start() 还挂着
    expect(store.getState().recording).toBe(false)

    store.abortCycle()
    recorder.resumeStart()
    await running
    await tick(0)

    expect(store.getState().recording).toBe(false)
    expect(store.getState().cycleStep).toBe('idle')
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
