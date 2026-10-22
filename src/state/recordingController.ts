/**
 * 一次录音的完整生命周期：开麦 → 记电平 → 停录 → 组装 take → 落库 → 淘汰旧录音。
 *
 * 从 `state/session.ts` 抽出来的原因：这段有**自己的三个字段**（噪声底、本次峰值、
 * 判定阈值）和一套失败处理（开麦失败 / 太短丢弃 / 存盘失败保留旧录音 / 删旧失败只告警）。
 * 跟「加载音频、算块、管锚点、导航」没有关系，混在 store 里既看不清也难单独测。
 *
 * 判定「说完没有」用原始电平（本类的 `noteLevel` 返回阈值，由调用方交给 CycleRunner）；
 * 给 UI 看的电平走 `LevelMeter` 的节流，两条路不能混。
 */
import { NOISE_FLOOR_INIT, VOICE_LEVEL, voiceThreshold } from '../core/recording'
import type { AudioPlayerPort, Chunk, RecorderPort, Take, TakeRepoPort } from '../core/ports'
import type { LevelMeter } from './levelMeter'
import type { SessionState } from './sessionConfig'
import { recordLocalActivity } from './localActivity'

/** 录音器需要的宿主能力（store 把现成的实现递进来，别缓存状态） */
export interface RecordingHost {
  state(): SessionState
  set(patch: Partial<SessionState>): void
  chunk(): Chunk | null
  /** 参考音播放器：录音前要停，试录后要回放 */
  player: AudioPlayerPort
  recorder: RecorderPort
  repo: TakeRepoPort
  level: LevelMeter
  /** 说话声判定阈值（没注入时用 `core/recording` 的默认值） */
  voiceLevel(): number | undefined
  /** 中止跑着的连续跟读（试录音前先让出麦克风） */
  abortCycle(): void
  /** 停掉 A/B 对比（录音前必须静音） */
  stopAb(): void
  /** 回放一条录音（试录用） */
  playTake(take: Take): Promise<void>
}

/** 手滑/没说话的下限：短于这个时长直接丢，不占存储也不弹提示 */
const MIN_TAKE_SEC = 0.2
/** 峰值低于这个值就认为麦克风增益太小（0..1） */
const LOW_PEAK = 0.03

export class RecordingController {
  /** 噪声底：录音期间见过的最低电平，用来自适应说话阈值（不同麦克风增益差很多） */
  private noiseFloor = NOISE_FLOOR_INIT
  /** 这次录音见过的最高电平，用完判断「麦克风是不是太小声」 */
  private recPeak = 0

  constructor(private host: RecordingHost) {}

  /**
   * 电平回调（每帧都来）。只在录音期间更新统计，返回当前说话阈值：
   * 噪声底只取「见过的最低电平」，单调不增 —— 连续朗读时也不会被自己的语音抬高。
   */
  noteLevel(level: number): number {
    if (this.host.state().recording) {
      if (level > this.recPeak) this.recPeak = level
      if (level < this.noiseFloor) this.noiseFloor = level
    }
    return voiceThreshold(this.noiseFloor, this.host.voiceLevel() ?? VOICE_LEVEL)
  }

  async start(): Promise<void> {
    if (this.host.state().recording || !this.host.chunk()) return
    this.host.player.pause()
    this.host.stopAb()
    try {
      await this.host.recorder.start()
      this.noiseFloor = NOISE_FLOOR_INIT
      this.recPeak = 0
      this.host.level.resetThrottle() // 让第一帧电平立刻进 state
      this.host.set({ recording: true })
    } catch (e) {
      this.host.set({ error: e instanceof Error ? e.message : String(e) })
    }
  }

  /** 停止并保存；返回存下的那条（太短被丢掉时返回 null） */
  async stop(): Promise<Take | null> {
    if (!this.host.state().recording) return null
    const c = this.host.chunk()
    const state = this.host.state()
    this.host.set({ recording: false, level: 0 })
    this.host.level.flush(0) // 电平归零 + 清掉可能还挂着的节流定时器
    let take: Awaited<ReturnType<RecorderPort['stop']>>
    try {
      take = await this.host.recorder.stop()
    } catch (e) {
      this.host.set({ error: `停止录音失败：${e instanceof Error ? e.message : String(e)}` })
      return null
    }
    if (take.durationSec < MIN_TAKE_SEC) return null // 手滑了

    // 峰值太低多半是麦克风增益没调起来：提示去系统里调大（别让它一直又小又难判定）
    this.host.set({ lowMic: this.recPeak < LOW_PEAK })

    const record: Take = {
      id: crypto.randomUUID(),
      fileName: state.fileName,
      chunkIndex: state.current,
      // 记下参考音的时间区间：块号会变（切块档位/手动撕开），时间不会
      startSec: c?.start,
      endSec: c?.end,
      mimeType: take.mimeType,
      durationSec: take.durationSec,
      // 首尾静音区间：录音器解码时算好的，回放只放这段（老录音没有，播放器现算）
      speechFrom: take.speechFrom,
      speechTo: take.speechTo,
      createdAt: Date.now(),
      blob: take.blob,
    }
    // 先存新的，成功了再删旧的：存储满 / 隐私模式下 save 失败时，旧录音还在。
    try {
      await this.host.repo.save(record)
    } catch (e) {
      this.host.set({
        error: `录音保存失败（存储空间可能已满）：${e instanceof Error ? e.message : String(e)}。旧录音已保留。`,
      })
      return null
    }

    // 旧录音不留：同一块只保留最新的一条，够「复读」用就行，
    // 不然一遍遍练下来会堆一大堆没用的历史。别的块不动。
    const stale = state.takes.filter((t) => t.chunkIndex === record.chunkIndex)
    for (const t of stale) {
      try {
        await this.host.repo.remove(t.id)
      } catch (e) {
        // 新录音已经落盘，删旧失败只是多占空间，不该让整次录音失败。
        console.warn('[录音] 删除旧 take 失败', e)
      }
    }
    recordLocalActivity('speak')
    this.host.set({
      takes: [...state.takes.filter((t) => t.chunkIndex !== record.chunkIndex), record],
    })
    return record
  }

  /** 试录几秒并回放，只为听音色/排查发闷，不落盘、不占当前块的录音。 */
  async test(ms = 2500): Promise<void> {
    if (this.host.state().recording || this.host.state().status !== 'ready') return
    this.host.abortCycle()
    this.host.player.pause()
    try {
      await this.host.recorder.start()
    } catch (e) {
      this.host.set({ error: e instanceof Error ? e.message : String(e) })
      return
    }
    this.host.set({ recording: true, level: 0 })
    await sleep(ms)
    const t = await this.host.recorder.stop()
    this.host.set({ recording: false, level: 0 })
    if (t.durationSec < MIN_TAKE_SEC) return
    await this.host.playTake({
      id: crypto.randomUUID(),
      fileName: this.host.state().fileName,
      chunkIndex: -1,
      mimeType: t.mimeType,
      durationSec: t.durationSec,
      speechFrom: t.speechFrom,
      speechTo: t.speechTo,
      createdAt: Date.now(),
      blob: t.blob,
    })
  }
}

function sleep(ms: number) {
  return new Promise<void>((r) => setTimeout(r, ms))
}
