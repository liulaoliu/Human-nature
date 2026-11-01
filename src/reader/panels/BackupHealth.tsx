import { useEffect, useState } from 'react'
import { backupReminder } from '../../core/backupReminder'
import { BACKUP_EXPORTED_EVENT, markBackupAt, readLastBackupAt } from '../../adapters/backupHealth'

/**
 * 备份健康提示：只负责「上次导出多久了 + 下载整库入口」。
 *
 * 备份和主库默认在同一块盘，`data/backups/` 挡不住磁盘损坏；这里不制造焦虑，
 * 只在超过一周（或从没导过）时把提示变成警示色。
 */
export default function BackupHealth() {
  const [lastAt, setLastAt] = useState<string | null>(() => readLastBackupAt())

  useEffect(() => {
    const refresh = () => setLastAt(readLastBackupAt())
    window.addEventListener(BACKUP_EXPORTED_EVENT, refresh)
    return () => window.removeEventListener(BACKUP_EXPORTED_EVENT, refresh)
  }, [])

  const reminder = backupReminder(lastAt)
  return (
    <div className={`backup-health ${reminder.level}`} title={reminder.detail}>
      <span>{reminder.text}</span>
      <a
        href="/api/store/db"
        download="xueba.db"
        onClick={() => markBackupAt()}
        title="下载一致性整库快照（需要本地服务）；存到另一块盘或网盘"
      >
        下载整库
      </a>
    </div>
  )
}
