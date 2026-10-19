/**
 * SQLite 优先 / IndexedDB 兜底的「模式选择器」（两个 HybridRepo 共用）。
 *
 * 关键点：服务挂掉一次后不能永久锁死在 local —— 否则用户把服务重新启动，
 * 这一整个会话仍然只写 IndexedDB，刷新前看起来都“保存成功”，实际主库没收到。
 * 失败后 30 秒再轻量探一次 `storeHealth()`；探活成功自动切回 SQLite。
 */
export const HYBRID_RETRY_MS = 30_000

type Mode = 'unknown' | 'sqlite' | 'local'

export class HybridMode {
  private mode: Mode = 'unknown'
  private retryAt = 0

  constructor(
    private readonly probe: () => Promise<boolean>,
    private readonly retryMs = HYBRID_RETRY_MS,
    private readonly now: () => number = () => Date.now(),
  ) {}

  /** 现在该走 SQLite 吗？local 模式下过了退避窗口会重新探活。 */
  async useSqlite(): Promise<boolean> {
    if (this.mode === 'sqlite') return true
    if (this.mode === 'local' && this.now() < this.retryAt) return false
    const ok = await this.probe()
    this.mode = ok ? 'sqlite' : 'local'
    this.retryAt = ok ? 0 : this.now() + this.retryMs
    return ok
  }

  /** 一次操作失败：先走 local 兜底，30 秒后再试 SQLite。 */
  fail(): void {
    this.mode = 'local'
    this.retryAt = this.now() + this.retryMs
  }
}
