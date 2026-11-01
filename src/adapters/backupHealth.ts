import { LAST_BACKUP_KEY } from '../core/backupReminder'

/** 浏览器里 localStorage 可能被隐私模式禁用，读写都兜底。 */
function storage(): Storage | null {
  try {
    return typeof window !== 'undefined' ? window.localStorage : null
  } catch {
    return null
  }
}

/** 上次「导出全部」的时间。localStorage 不可用（隐私模式/配额满）就当没导过。 */
export function readLastBackupAt(): string | null {
  try {
    return storage()?.getItem(LAST_BACKUP_KEY) ?? null
  } catch {
    return null
  }
}

/** 备份导出后广播一次，让同一页里的提醒条立刻刷新。 */
export const BACKUP_EXPORTED_EVENT = 'xueba:backup-exported'

export function markBackupAt(at = new Date().toISOString()): void {
  try {
    storage()?.setItem(LAST_BACKUP_KEY, at)
  } catch {
    // 记不下来不影响备份本身
  }
  try {
    window.dispatchEvent(new Event(BACKUP_EXPORTED_EVENT))
  } catch {
    // 非浏览器环境（测试/SSR）没有 window
  }
}
