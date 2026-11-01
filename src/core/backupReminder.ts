/**
 * 备份提醒：备份和主库在同一块盘时，唯一可靠的兜底是**把一份文件放到别处**。
 *
 * 纯函数只算「上次导出到现在过了多久」；localStorage 读写放在
 * `adapters/backupHealth`，核心层不碰浏览器 API。
 */

/** localStorage 里记录「上次点导出全部」的时间（ISO）。 */
export const LAST_BACKUP_KEY = 'reader:lastBackupAt'

export type BackupLevel = 'never' | 'ok' | 'due'

export interface BackupReminder {
  level: BackupLevel
  /** 距上次导出过了多少天；从没导出过时是 -1。 */
  days: number
  /** 一行短提示，直接显示在备份按钮旁。 */
  text: string
  /** 展开后的原因/建议。 */
  detail: string
}

const DAY_MS = 24 * 60 * 60 * 1000

export function backupReminder(
  lastAt: string | null | undefined,
  now = Date.now(),
  dueDays = 7,
): BackupReminder {
  const ms = lastAt ? Date.parse(lastAt) : NaN
  if (!Number.isFinite(ms)) {
    return {
      level: 'never',
      days: -1,
      text: '还没导出过备份',
      detail: '备份和主库在同一块盘；点「导出全部」存到别的盘，或下载整库快照。',
    }
  }
  const days = Math.max(0, Math.floor((now - ms) / DAY_MS))
  if (days >= dueDays) {
    return {
      level: 'due',
      days,
      text: `上次导出：${days} 天前`,
      detail: '备份和主库在同一块盘，建议每周导出一次到别的盘。',
    }
  }
  return {
    level: 'ok',
    days,
    text: days === 0 ? '上次导出：今天' : `上次导出：${days} 天前`,
    detail: '备份文件记得放在另一块盘或网盘；同盘备份挡不住磁盘损坏。',
  }
}
