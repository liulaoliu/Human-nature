import { chmodSync, existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { SCHEMA_VERSION } from './sqliteSchema.js'

/** schema 迁移前的整库备份，留最近 5 份。 */
const DB_BACKUP_KEEP = 5
/** 每天第一次打开时留一份整库备份，留最近 7 天。 */
const DAILY_BACKUP_KEEP = 7

function backupsDir(dbPath) {
  const dir = join(dirname(dbPath), 'backups')
  mkdirSync(dir, { recursive: true, mode: 0o700 })
  return dir
}

function pruneBackups(dir, pattern, keep) {
  const files = readdirSync(dir)
    .filter((name) => pattern.test(name))
    .sort()
  for (const name of files.slice(0, Math.max(0, files.length - keep))) {
    rmSync(join(dir, name), { force: true })
  }
}

/** 备份写完立刻用只读连接做 quick_check；坏文件不能当成“还有一份”。 */
function verifyBackup(file, DatabaseSync) {
  if (!DatabaseSync) return
  let db = null
  try {
    db = new DatabaseSync(file, { readOnly: true })
    const row = db.prepare('PRAGMA quick_check').get()
    const result = row ? String(Object.values(row)[0] ?? '') : ''
    if (result !== 'ok') throw new Error(`quick_check = ${result || '空结果'}`)
  } finally {
    try {
      db?.close()
    } catch {
      // ignore
    }
  }
}

function vacuumInto(db, file, DatabaseSync) {
  const target = file.replace(/'/g, "''")
  db.exec(`VACUUM INTO '${target}'`)
  try {
    chmodSync(file, 0o600)
  } catch {
    // Windows 忽略权限位
  }
  try {
    verifyBackup(file, DatabaseSync)
  } catch (e) {
    // 校验失败的备份没有保留价值，删掉让下次重试，别让它占着“当天已有备份”的位置。
    rmSync(file, { force: true })
    throw e
  }
}

/**
 * schema 升级前把整库 VACUUM 成独立文件，放在 `data/backups/`。
 * 迁移只增不删，但真出事故时至少要能回到升级前；保留最近 5 份。
 */
export function backupBeforeMigration(db, dbPath, version, DatabaseSync) {
  if (version <= 0 || version >= SCHEMA_VERSION) return null
  const dir = backupsDir(dbPath)
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const file = join(dir, `xueba-v${version}-${stamp}.db`)
  vacuumInto(db, file, DatabaseSync)
  pruneBackups(dir, /^xueba-v\d+-.*\.db$/, DB_BACKUP_KEEP)
  return file
}

/**
 * 每天首次打开已有库时做一份整库备份。
 *
 * 不是替代学习记录快照：快照防误清空，这个防「整个文件被误删/改坏后没有第二份」。
 * 只在本进程当天第一次打开时做；已经存在当天文件就跳过。
 */
export function backupDaily(db, dbPath, version, DatabaseSync) {
  if (version <= 0) return null
  const dir = backupsDir(dbPath)
  const day = new Date().toISOString().slice(0, 10)
  const file = join(dir, `xueba-daily-${day}.db`)
  if (existsSync(file)) {
    try {
      // 已有的当天备份也要验；磁盘写坏/拷坏时重新做一份，不能因为文件名在就跳过。
      verifyBackup(file, DatabaseSync)
      return null
    } catch (e) {
      console.warn('[sqlite] 当天备份校验失败，重新生成：', e instanceof Error ? e.message : e)
      rmSync(file, { force: true })
    }
  }
  vacuumInto(db, file, DatabaseSync)
  pruneBackups(dir, /^xueba-daily-.*\.db$/, DAILY_BACKUP_KEEP)
  return file
}
