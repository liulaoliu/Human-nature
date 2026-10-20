import type { LearningRepoPort } from '../core/ports'
import { normalizeLearning, type LearningData } from '../core/learning'
import { storeHealth, storeRequest } from './storeApi'

interface LearningResponse {
  ok: boolean
  value?: unknown
}

interface MigrateResponse {
  ok: boolean
  migrated?: boolean
  value?: unknown
}

/**
 * 学习记录的 SQLite 仓储。
 *
 * 只走 `/api/store/learning`；偏好/会话状态不要塞进来。
 * 没有本地服务（静态部署 / Node 太老）时 `load` 返回 null，`save` 抛
 * `StoreUnavailableError`，由调用方保持 localStorage 兜底。
 */
export class SqliteLearningRepo implements LearningRepoPort {
  private available: Promise<boolean> | null = null

  private async canUse(): Promise<boolean> {
    if (!this.available) this.available = storeHealth()
    const ok = await this.available
    // 服务没起时别把 false 永久缓存：用户可能稍后启动服务。
    if (!ok) this.available = null
    return ok
  }

  /** 服务不可用时返回 null；空库返回空记录（调用方自己判断有没有数据）。 */
  async load(): Promise<LearningData | null> {
    if (!(await this.canUse())) return null
    const res = await storeRequest<LearningResponse>('/learning', {}, undefined, 2000)
    return normalizeLearning(res.value)
  }

  async save(data: LearningData): Promise<void> {
    if (!(await this.canUse())) throw new Error('学习记录服务不可用')
    await storeRequest('/learning', { method: 'PUT', body: JSON.stringify(data) }, undefined, 3000)
  }

  /** 只提交变化的 section；服务端只删/插对应表。 */
  async savePartial(data: Partial<LearningData>): Promise<void> {
    if (!(await this.canUse())) throw new Error('学习记录服务不可用')
    await storeRequest('/learning/partial', { method: 'PUT', body: JSON.stringify(data) }, undefined, 3000)
  }

  /** 首次迁移：只往空库写，避免两个标签页/两台机器互相覆盖。 */
  async migrate(data: LearningData): Promise<{ migrated: boolean; value: LearningData } | null> {
    if (!(await this.canUse())) return null
    const res = await storeRequest<MigrateResponse>(
      '/learning/if-empty',
      { method: 'PUT', body: JSON.stringify(data) },
      undefined,
      3000,
    )
    return { migrated: res.migrated === true, value: normalizeLearning(res.value) }
  }

  /**
   * 用答题事件重建派生聚合（活动 / 题型统计），返回**重建后**的整份记录。
   * 服务不可用返回 null（调用方按「做不到」处理）。
   */
  async rebuildDerived(): Promise<LearningData | null> {
    if (!(await this.canUse())) return null
    const res = await storeRequest<LearningResponse>('/learning/rebuild-derived', { method: 'POST' }, undefined, 5000)
    return normalizeLearning(res.value)
  }
}

export const learningRepo = new SqliteLearningRepo()
