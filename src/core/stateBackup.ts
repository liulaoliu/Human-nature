/**
 * 本机进度备份：把 localStorage 里的 `shadowing.*` 打成一个 JSON 带走。
 *
 * 只备份 localStorage（校准 + 改过的正文）。录音在 IndexedDB 里、且是音频，
 * 体积大，不在这里 —— 换电脑想带录音得另说。
 */

export const BACKUP_APP = 'shadowing'
export const BACKUP_VERSION = 1
/** 项目里那份种子文件的固定名字（放 public/ 下） */
export const PROJECT_STATE_FILE = 'shadowing-state.json'

export interface StateBackup {
  app: typeof BACKUP_APP
  version: number
  exportedAt: number
  /** localStorage 的 key → 原始字符串值 */
  data: Record<string, string>
}

export function makeBackup(data: Record<string, string>, now = Date.now()): StateBackup {
  return { app: BACKUP_APP, version: BACKUP_VERSION, exportedAt: now, data: { ...data } }
}

/** 解析上传/项目里的备份；不是我们的东西就返回 null（不抛） */
export function parseBackup(text: string): StateBackup | null {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return null
  }
  if (!raw || typeof raw !== 'object') return null
  const obj = raw as Record<string, unknown>
  if (obj.app !== BACKUP_APP) return null
  if (!obj.data || typeof obj.data !== 'object') return null

  const data: Record<string, string> = {}
  for (const [k, v] of Object.entries(obj.data as Record<string, unknown>)) {
    if (typeof v === 'string') data[k] = v
  }
  return {
    app: BACKUP_APP,
    version: typeof obj.version === 'number' ? obj.version : 0,
    exportedAt: typeof obj.exportedAt === 'number' ? obj.exportedAt : 0,
    data,
  }
}

export function backupFileName(now = new Date()): string {
  const d = now.toISOString().slice(0, 10)
  return `shadowing-backup-${d}.json`
}
