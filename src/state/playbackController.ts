/**
 * 导航与参考音播放：切块、空格键的播放/暂停、整篇连播、波形试听。
 *
 * 从 `state/session.ts` 抽出来的原因：这块有**一条容易写错的状态契约**——
 * 「暂停再播」要接着播而不是从头（靠 `pausedChunk` + 播放位置判断），
 * 而切块时必须把旧的暂停点作废；同时空格键在连续跟读开着时不能走播放这条路，
 * 要整轮交给 CycleRunner。这些规则和「加载音频 / 校准 / 录音落库」无关，
 * 单独放一处才好改。
 */
import type { AudioPlayerPort, Chunk } from '../core/ports'
import type { SessionState } from './sessionConfig'

/** 播放需要的宿主能力 */
export interface PlaybackHost {
  state(): SessionState
  set(patch: Partial<SessionState>): void
  chunk(): Chunk | null
  player: AudioPlayerPort
  /** 停掉 A/B（A/B 自己会动播放位置） */
  stopAb(): void
  /** 让跑着的连续跟读自己退出 */
  abortCycle(): void
  /** 空格键在连续跟读模式下跑一整轮 */
  runAutoCycle(): Promise<void>
}

/** 暂停点允许「接着播」的边界（太靠头/尾就当成从头播） */
const RESUME_HEAD_SEC = 0.05
const RESUME_TAIL_SEC = 0.15

export class PlaybackController {
  constructor(private host: PlaybackHost) {}

  /**
   * 只改当前块，不播。列表里点某一行用它 ——
   * 点一下未必是想听，可能只是想看看这块的文字和时间。
   */
  select(index: number): void {
    if (index < 0 || index >= this.host.state().chunks.length) return
    this.host.stopAb()
    // 换块了：上次的暂停位置不算数，正在跑的那一轮也别继续了
    if (this.host.state().cycleStep !== 'idle') this.host.abortCycle()
    this.host.set({ current: index, pausedChunk: null })
  }

  /**
   * 切块并直接跑「空格键那一套」。上一块/下一块用它。
   * 挪过去就当你按了空格：没开连续跟读就是播标准音，开了就跑一整圈。
   * 这样手动按 ↓ 和按空格是同一个入口，不会有两套行为。
   */
  private async selectAndPlay(index: number): Promise<void> {
    if (index < 0 || index >= this.host.state().chunks.length) return
    if (index === this.host.state().current) return // 已经在边界上，别重放
    this.select(index)
    // 录音时不能放参考音，会被麦克风录进去
    if (this.host.state().recording) return
    // 上一块可能还在播：先停干净，免得空格那条路看到 playing=true 反而去暂停
    if (this.host.state().playing) {
      this.host.player.pause()
      this.host.set({ playing: false })
    }
    await this.toggleChunkPlay()
  }

  next(): void {
    void this.selectAndPlay(this.host.state().current + 1)
  }

  prev(): void {
    void this.selectAndPlay(this.host.state().current - 1)
  }

  async playChunk(): Promise<void> {
    const c = this.host.chunk()
    if (!c) return
    this.host.stopAb()
    // 暂停过（而且是同一块）就接着播，否则从头 —— 否则「暂停再播」等于重播
    const p = this.host.player.position
    const resumable =
      this.host.state().pausedChunk === c.index &&
      p > c.start + RESUME_HEAD_SEC &&
      p < c.end - RESUME_TAIL_SEC
    this.host.set({ playing: true, pausedChunk: null })
    try {
      await this.host.player.playRange(resumable ? p : c.start, c.end, this.host.state().rate)
    } finally {
      // 播完（或在别处被 pause 掉）都要把状态收回来，不然按钮一直显示「暂停」
      this.host.set({ playing: false })
    }
  }

  /**
   * 空格键：没在播就播，在播就暂停。
   * 暂停会记住位置和是哪一块，所以再按一下是**接着**播，不是从头重来。
   */
  async toggleChunkPlay(): Promise<void> {
    if (this.host.state().autoCycle) {
      await this.host.runAutoCycle()
      return
    }
    if (this.host.state().playing) {
      this.host.player.pause()
      this.host.set({ playing: false, pausedChunk: this.host.state().current })
      return
    }
    await this.playChunk()
  }

  async playWhole(): Promise<void> {
    this.host.stopAb()
    // 整篇连播会把位置带到别处，之前那个「暂停点」就不再是暂停点了
    this.host.set({ pausedChunk: null })
    await this.host.player.playWhole(this.host.state().rate)
  }

  /** 试听任意区间（波形刀口定位用），不碰当前块和播放状态 */
  auditionRange(start: number, end: number): Promise<void> {
    this.host.player.pause()
    return this.host.player.playRange(start, end, this.host.state().rate)
  }

  /** 停掉试听 */
  stopPreview(): void {
    this.host.player.pause()
  }

  /** 参考音当前播到哪一秒（波形面板画进度线用） */
  playbackPosition(): number {
    return this.host.player.position
  }
}
