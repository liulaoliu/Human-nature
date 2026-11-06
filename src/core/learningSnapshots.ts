/**
 * 学习记录快照的**外部输入守卫**。
 *
 * `/api/store/learning/snapshots` 的响应、以及以后可能出现的导入文件，都不许
 * `as LearningSnapshotMeta[]` 直接进界面：坏条目丢掉并计数，界面能如实提示。
 * 服务端写入侧见 `server/sqliteLearning.ts`。
 */
import { calendarDayKey } from './activity'

export interface LearningSnapshotMeta {
  at: string
  reason: string
  bytes: number
}

export interface ParsedLearningSnapshots {
  snapshots: LearningSnapshotMeta[]
  dropped: number
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v)
}

/** 只认「at 是 ISO 时间、bytes 是有限非负数」的条目；其余计入 dropped。 */
export function parseLearningSnapshots(value: unknown): ParsedLearningSnapshots {
  if (!Array.isArray(value)) return { snapshots: [], dropped: 0 }
  const snapshots: LearningSnapshotMeta[] = []
  let dropped = 0
  for (const item of value) {
    if (!isRecord(item)) {
      dropped++
      continue
    }
    const at = typeof item.at === 'string' ? item.at : ''
    const ms = Date.parse(at)
    const bytes = Number(item.bytes)
    if (!at || !Number.isFinite(ms) || !Number.isFinite(bytes) || bytes < 0) {
      dropped++
      continue
    }
    snapshots.push({
      at,
      reason: typeof item.reason === 'string' ? item.reason : '',
      bytes,
    })
  }
  // 服务端已按时间倒序；这里再排一次，防止手工构造的响应乱序
  snapshots.sort((a, b) => b.at.localeCompare(a.at))
  return { snapshots, dropped }
}

/** 快照列表里的中文来源标签。未知值原样显示，方便排查新来源。 */
export function snapshotReasonLabel(reason: string): string {
  switch (reason) {
    case 'auto':
      return '自动'
    case 'manual':
      return '手动'
    case 'before-full-replace':
      return '整份覆盖前'
    case 'before-rebuild':
      return '重建前'
    case 'before-restore':
      return '恢复前'
    default:
      return reason || '未知'
  }
}

/** 按用户本地时区显示到分钟（快照文件名仍由服务端按 UTC 生成）。 */
export function formatSnapshotAt(at: string): string {
  const ms = Date.parse(at)
  if (!Number.isFinite(ms)) return at
  const d = new Date(ms)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${calendarDayKey(d)} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export function formatSnapshotBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 KB'
  if (bytes < 1024) return `${bytes} B`
  const kb = bytes / 1024
  return kb < 1024 ? `${kb.toFixed(0)} KB` : `${(kb / 1024).toFixed(1)} MB`
}
