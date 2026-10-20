import { describe, it, expect } from 'vitest'
import type { Take } from '../core/ports'
import { blob, makeStore } from './sessionDoubles'

/**
 * SessionStore 录音（落块 / 替换旧录音 / 按文章隔离）。
 * 假播放器 / 假录音器 / 假录音仓在 `sessionDoubles`（四个文件共用）。
 */
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

  it('换到另一篇不会删掉上一篇的录音（清理只碰本篇）', async () => {
    const { store, repo } = makeStore()
    await store.load(blob, 'a.mp3')
    store.select(1)
    await store.toggleRecording()
    await store.toggleRecording()
    const aTake = store.getState().takes[0]
    expect(repo.map.has(aTake.id)).toBe(true)

    // 加载 b 时会去重 + 清理多余记录（同一块只留最新一条）
    await store.load(blob, 'b.mp3')
    // a 的那条必须还在库里 —— listByFile 之后清理范围只能是本篇
    expect(repo.map.has(aTake.id)).toBe(true)
    expect([...repo.map.values()].filter((t) => t.fileName === 'a.mp3')).toHaveLength(1)
    expect(store.getState().takes).toEqual([])
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
