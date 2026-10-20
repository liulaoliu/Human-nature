import { recordCapMs } from '../core/recording'
import type { AudioPlayerPort, Chunk, RecorderPort, Take } from '../core/ports'
import type { SessionState } from './sessionConfig'

/**
 * 连续跟读的那一轮：标准音 →（喘口气）→ 录音（按块长自动停）→ 回放刚才那条录音。
 *
 * 从 `state/session.ts` 抽出来的原因：这一轮有**自己的五个字段**（轮次号、录音定时器、
 * 说过话没有、最后一次说话的时刻、这一轮从哪秒开始）和一整套「提前收尾」规则：
 *   · 录音中按空格/R = 我读完了，直接回放（不等自动停）
 *   · 标准音/回放中按空格 = 中止这一轮；按 R 则中止并开始手动录音
 *   · 中途换块/换开关 = 让跑着的那一轮自己退出（`generation` 计数）
 * 这些跟「加载音频、算块、管锚点」没有关系，留在一个类里才看得清。
 *
 * 判定「说完没有」用**原始电平**（`noteLevel`），不受电平表节流影响；
 * 「想读到哪」的兜底上限由 `core/recording` 的 `recordCapMs` 算。
 */
export interface CycleHost {
  /** 当前状态（每次读现成的，别缓存） */
  state(): SessionState
  set(patch: Partial<SessionState>): void
  chunk(): Chunk | null
  player: AudioPlayerPort
  recorder: RecorderPort
  /** 开始录音（含开麦失败的处理） */
  startRecording(): Promise<void>
  /** 停止并保存；太短被丢弃时返回 null */
  stopRecording(): Promise<Take | null>
  playTake(take: Take): Promise<void>
  stopAb(): void
  /** 「标准音 → 录音」之间的停顿（测试可注入） */
  cycleGapMs(): number
  /** 「说完静多久算读完」：注入值优先，否则用状态里的（用户可调） */
  hangoverMs(): number
}

export class CycleRunner {
  /** 连续跟读的轮次号：中途改主意时靠它让跑着的那一轮自己退出 */
  private generation = 0
  private recordTimer: ReturnType<typeof setInterval> | null = null
  /** 这一轮录音里说过话没有 / 最后一次说话的时刻 / 这一轮从哪秒开始 */
  private speechSeen = false
  private lastVoiceAt = 0
  private recStartedAt = 0

  constructor(private host: CycleHost) {}

  /** 电平回调：录音期间判断「说过话没有」（传入原始值，不受电平表节流影响） */
  noteLevel(level: number, threshold: number, now = Date.now()): void {
    if (!this.host.state().recording) return
    if (level > threshold) {
      this.speechSeen = true
      this.lastVoiceAt = now
    }
  }

  /** 打开/关闭连续跟读。打开时先摸一下麦克风，免得走到录音那步才发现没权限 */
  async setEnabled(on: boolean): Promise<void> {
    this.abort()
    this.host.set({ autoCycle: on })
    if (!on) return
    try {
      await this.host.recorder.start()
      await this.host.recorder.stop() // 只为了触发权限/设备初始化，这段不留
      this.host.set({ error: null })
    } catch (e) {
      this.host.set({
        autoCycle: false,
        error: `麦克风打不开（${e instanceof Error ? e.message : String(e)}），连续跟读没打开`,
      })
    }
  }

  /** 空格键在连续跟读模式下的行为 */
  async run(): Promise<void> {
    if (this.host.state().cycleStep === 'rec') {
      // 录音中按 = 我读完了，直接回放刚才那条
      await this.stopThenPlayback()
      return
    }
    if (this.host.state().cycleStep !== 'idle') {
      this.abort()
      return
    }
    const c = this.host.chunk()
    if (!c) return
    const gen = ++this.generation
    this.host.stopAb()
    const rate = this.host.state().rate

    this.host.set({ cycleStep: 'ref', playing: true, pausedChunk: null })
    await this.host.player.playRange(c.start, c.end, rate)
    this.host.set({ playing: false })
    if (gen !== this.generation) return

    await sleep(this.host.cycleGapMs())
    if (gen !== this.generation) return

    await this.host.startRecording()
    if (gen !== this.generation) {
      // 开麦是异步的：等待期间用户按了空格 / 换块，abort 看到 recording=false
      // 不会停录；这里补一刀，避免麦克风留在录音态。
      if (this.host.state().recording) await this.host.stopRecording()
      this.host.set({ cycleStep: 'idle' })
      return
    }
    if (!this.host.state().recording) {
      this.host.set({ cycleStep: 'idle' })
      return
    }

    const capMs = recordCapMs(Math.max(0, c.end - c.start))
    this.speechSeen = false
    this.recStartedAt = Date.now()
    this.lastVoiceAt = this.recStartedAt
    this.host.set({ cycleStep: 'rec', autoRecordMs: capMs })
    // 每 200ms 看一次：说完静了一会儿就收工；一直没动静（或一直在说）就等兜底上限
    const hangover = this.hangover()
    this.recordTimer = setInterval(() => {
      const now = Date.now()
      const silentFor = now - this.lastVoiceAt
      const elapsed = now - this.recStartedAt
      if ((this.speechSeen && silentFor > hangover) || elapsed > capMs) {
        this.clearTimer()
        void this.stopThenPlayback()
      }
    }, 200)
  }

  /**
   * 停了录音、存下来，然后直接回放刚才那条（连续跟读的第 3 步）。
   * 只放「我的」，不再回头放标准音 —— 想对照标准音按 C 或再跑一轮。
   */
  async stopThenPlayback(): Promise<void> {
    this.clearTimer()
    const saved = await this.host.stopRecording()
    if (this.host.state().cycleStep !== 'rec') {
      this.host.set({ cycleStep: 'idle' })
      return
    }
    const gen = this.generation
    this.host.set({ cycleStep: 'playback' })
    if (saved) await this.host.playTake(saved)
    if (gen === this.generation) this.host.set({ cycleStep: 'idle' })
  }

  /** 让还在跑的那一轮自己退出（下次 await 回来时会看到轮次号变了） */
  abort(): void {
    this.generation++
    this.clearTimer()
    if (this.host.state().recording) void this.host.stopRecording()
    this.host.player.pause()
    this.host.stopAb()
    if (this.host.state().cycleStep !== 'idle' || this.host.state().playing) {
      this.host.set({ cycleStep: 'idle', playing: false })
    }
  }

  private clearTimer(): void {
    if (this.recordTimer !== null) {
      clearInterval(this.recordTimer)
      this.recordTimer = null
    }
  }

  private hangover(): number {
    return this.host.hangoverMs()
  }
}

function sleep(ms: number) {
  return new Promise<void>((r) => setTimeout(r, ms))
}
