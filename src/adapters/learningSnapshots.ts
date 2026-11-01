import { parseLearningSnapshots, type LearningSnapshotMeta } from '../core/learningSnapshots'
import { storeRequest } from './storeApi'

/** `/api/store/learning/snapshots` 的最小客户端；响应一律先过 core 守卫。 */

interface ListResponse {
  ok?: boolean
  value?: unknown
}

interface CreateResponse {
  ok?: boolean
  value?: unknown
}

interface RestoreResponse {
  ok?: boolean
  error?: string
}

export interface LearningSnapshotList {
  snapshots: LearningSnapshotMeta[]
  /** 服务端返回里形状不对、被守卫丢掉的条数。 */
  dropped: number
}

export async function listLearningSnapshots(): Promise<LearningSnapshotList> {
  const res = await storeRequest<ListResponse>('/learning/snapshots', {}, undefined, 3000)
  if (res?.ok !== true) throw new Error('学习快照接口不可用')
  return parseLearningSnapshots(res.value)
}

/** 手动拍一张；内容与上一张完全相同 → 服务端返回 null。 */
export async function createLearningSnapshot(): Promise<string | null> {
  const res = await storeRequest<CreateResponse>('/learning/snapshots', { method: 'POST' }, undefined, 5000)
  if (res?.ok !== true) throw new Error('学习快照创建失败')
  return typeof res.value === 'string' ? res.value : null
}

export async function restoreLearningSnapshot(at: string): Promise<void> {
  const res = await storeRequest<RestoreResponse>(
    '/learning/snapshots/restore',
    { method: 'POST', body: JSON.stringify({ at }) },
    undefined,
    10000,
  )
  if (res?.ok !== true) throw new Error(res?.error || '学习快照恢复失败')
}
