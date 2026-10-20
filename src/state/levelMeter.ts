/**
 * 音频电平的节流上报。
 *
 * 为什么要单独一个类：播放器每帧都回调电平（~60/s），直接塞进 store 的 state 就是
 * 每秒 60 次整页重渲染。这里把它**节流到 ~25/s**，而判定「说完没有」用的是调用方
 * 拿到的**原始值**（不受节流影响）—— 两条路不能混。
 *
 * 从 `state/session.ts` 抽出来：这段是纯粹的「计时 + 一个定时器」，跟跟读的业务无关，
 * 却占了 store 里 40 行和 3 个私有字段；抽出来还能用假定时器直接测。
 *
 * 间隔常量住在 `core/recording`（和「说完静音多久」「最多录多久」放一起），这里只引用。
 */
import { LEVEL_PUSH_MS } from '../core/recording'

export { LEVEL_PUSH_MS }

export class LevelMeter {
  /** 第一拍一定要能发出去，所以初值是「很久以前」 */
  private lastPushAt = Number.NEGATIVE_INFINITY
  private pending = 0
  private timer: ReturnType<typeof setTimeout> | null = null

  /**
   * @param push 真正把电平写进 state 的回调
   * @param now  取当前时间（测试注入假时钟）
   */
  constructor(
    private push: (level: number) => void,
    private now: () => number = Date.now,
  ) {}

  /** 收到一个电平读数（每帧都来）：到点了就发，没到点就记住，交给尾帧。 */
  accept(level: number): void {
    const now = this.now()
    const since = now - this.lastPushAt
    if (since >= LEVEL_PUSH_MS) {
      this.lastPushAt = now
      this.pending = level
      this.push(level)
      return
    }
    // 这一拍不发，但把最新值记下，交给尾帧发出去
    this.pending = level
    if (this.timer === null) {
      this.timer = setTimeout(() => {
        this.timer = null
        this.lastPushAt = this.now()
        this.push(this.pending)
      }, LEVEL_PUSH_MS - since)
    }
  }

  /** 立刻把待发值发出去（停录时用，免得电平表停在旧数字）。`value` 不给就发待发值 */
  flush(value?: number): void {
    this.clearTimer()
    this.pending = value ?? this.pending
    this.push(this.pending)
  }

  /** 让下一次读数立刻进 state（开始录音时用） */
  resetThrottle(): void {
    // 往后挪一个窗口，保证下一次 accept 一定满足「已经过了间隔」
    this.lastPushAt = this.now() - LEVEL_PUSH_MS
  }

  /** 停掉挂着的定时器（停录 / 销毁时都要调，免得卸载后还往 state 里写） */
  clearTimer(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer)
      this.timer = null
    }
  }
}
