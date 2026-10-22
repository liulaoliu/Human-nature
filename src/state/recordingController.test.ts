import { describe, it, expect } from 'vitest'
import { LevelMeter } from './levelMeter'
import { RecordingController, type RecordingHost } from './recordingController'
import { INITIAL } from './sessionConfig'
import { FakePlayer, FakeRecorder, FakeRepo } from './sessionDoubles'
import type { SessionState } from './sessionConfig'

/**
 * 录音控制器的单测：只喂假播放器 / 假录音器 / 假仓库，
 * 不经过 SessionStore，验证「开麦 → 落库 → 淘汰旧录音」这条链上的每个失败分支。
 */
function makeHost() {
  const player = new FakePlayer()
  const recorder = new FakeRecorder()
  const repo = new FakeRepo()
  const calls: string[] = []
  const box = {
    state: {
      ...INITIAL,
      status: 'ready' as const,
      fileName: 'a.mp3',
      duration: 10,
      chunks: [{ index: 0, start: 1, end: 3 }],
      current: 0,
    } as SessionState,
  }
  const host: RecordingHost = {
    state: () => box.state,
    set: (patch) => {
      box.state = { ...box.state, ...patch }
    },
    chunk: () => box.state.chunks[box.state.current] ?? null,
    player,
    recorder,
    repo,
    level: new LevelMeter(() => {}),
    voiceLevel: () => undefined,
    abortCycle: () => calls.push('abortCycle'),
    stopAb: () => calls.push('stopAb'),
    playTake: async (t) => {
      calls.push('playTake')
      await player.playTake(t, 1)
    },
  }
  return { host, player, recorder, repo, calls, box }
}

describe('RecordingController', () => {
  it('start 会先停参考音与 A/B，再开麦并重置统计', async () => {
    const { host, recorder, calls, box } = makeHost()
    const c = new RecordingController(host)
    await c.start()
    expect(recorder.startCount).toBe(1)
    expect(calls).toEqual(['stopAb'])
    expect(box.state.recording).toBe(true)
  })

  it('start 失败把错误写进 state，不进入录音态', async () => {
    const { host, recorder, box } = makeHost()
    recorder.shouldFail = true
    const c = new RecordingController(host)
    await c.start()
    expect(box.state.recording).toBe(false)
    expect(box.state.error).toContain('麦克风被占用')
  })

  it('没加载好 / 已经在录 / 没有块，都不重复开麦', async () => {
    const { host, recorder, box } = makeHost()
    const c = new RecordingController(host)
    box.state = { ...box.state, recording: true }
    await c.start()
    expect(recorder.startCount).toBe(0)

    box.state = { ...box.state, recording: false, chunks: [] }
    await c.start()
    expect(recorder.startCount).toBe(0)
  })

  it('stop 把 take 落库：带上文件名、块号、参考音区间与首尾静音', async () => {
    const { host, recorder, repo, box } = makeHost()
    recorder.speechFrom = 0.4
    recorder.speechTo = 2.2
    const c = new RecordingController(host)
    await c.start()
    const take = await c.stop()
    expect(take).not.toBeNull()
    expect(take?.fileName).toBe('a.mp3')
    expect(take?.chunkIndex).toBe(0)
    expect(take?.startSec).toBe(1)
    expect(take?.endSec).toBe(3)
    expect(take?.speechFrom).toBe(0.4)
    expect(take?.speechTo).toBe(2.2)
    expect(repo.map.size).toBe(1)
    expect(box.state.takes).toHaveLength(1)
    expect(box.state.recording).toBe(false)
  })

  it('太短（<0.2s）直接丢，不落库', async () => {
    const { host, recorder, repo, box } = makeHost()
    const c = new RecordingController(host)
    await c.start()
    const origStop = recorder.stop.bind(recorder)
    recorder.stop = async () => ({ ...(await origStop()), durationSec: 0.1 })
    expect(await c.stop()).toBeNull()
    expect(repo.map.size).toBe(0)
    expect(box.state.takes).toEqual([])
  })

  it('同块旧录音在保存成功后删除（先存后删）', async () => {
    const { host, repo, box } = makeHost()
    const stale = {
      id: 'old',
      fileName: 'a.mp3',
      chunkIndex: 0,
      mimeType: 'audio/webm',
      durationSec: 1,
      createdAt: 1,
      blob: new Blob(['old']),
    }
    repo.map.set('old', stale)
    box.state = { ...box.state, takes: [stale] }
    const c = new RecordingController(host)
    await c.start()
    const take = await c.stop()
    expect(repo.calls).toEqual(['save', 'remove'])
    expect(repo.map.has('old')).toBe(false)
    expect(box.state.takes.map((t) => t.id)).toEqual([take?.id])
  })

  it('存盘失败：保留旧录音，返回 null 并提示', async () => {
    const { host, repo, box } = makeHost()
    repo.failSave = true
    const c = new RecordingController(host)
    await c.start()
    expect(await c.stop()).toBeNull()
    expect(box.state.error).toContain('旧录音已保留')
    expect(box.state.takes).toEqual([])
  })

  it('noteLevel 只在录音期间更新噪声底，非录音时阈值不动', () => {
    const { host, box } = makeHost()
    const c = new RecordingController(host)
    const idle = c.noteLevel(0.5) // 非录音：只算阈值，不改统计
    box.state = { ...box.state, recording: true }
    const during = c.noteLevel(0.001) // 见到比初值更低的电平 → 噪声底下调
    expect(during).toBeLessThan(idle)
    box.state = { ...box.state, recording: false }
    c.noteLevel(0.9) // 非录音期间的高电平不该抬高噪声底
    expect(c.noteLevel(0.001)).toBeCloseTo(during, 6)
  })

  it('test 录一小段就回放，不落库', async () => {
    const { host, recorder, repo, calls } = makeHost()
    const c = new RecordingController(host)
    await c.test(1)
    expect(recorder.startCount).toBe(1)
    expect(recorder.stopCount).toBe(1)
    expect(calls).toContain('abortCycle')
    expect(calls).toContain('playTake')
    expect(repo.map.size).toBe(0)
  })
})
