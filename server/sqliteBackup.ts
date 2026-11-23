import { chmodSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { gzipSync } from 'node:zlib'
import type { DatabaseSync } from 'node:sqlite'
import { SCHEMA_VERSION } from './sqliteSchema.ts'
import { localDayKey } from './localDate.ts'

/**
 * node:sqlite 的构造器类型。调用方（sqliteStore）用 `require('node:sqlite')`
 * 动态引入、延迟注入 —— 保持「可选依赖」的旧设计不变（构造器类型只在编译期用）。
 */
type DatabaseSyncCtor = typeof DatabaseSync

/** schema 迁移前的整库备份，留最近 5 份。 */
const DB_BACKUP_KEEP = 5
/** 每天第一次打开时留一份整库备份，留最近 5 天（一天 ~155MB，5 天就近 1G）。 */
const DAILY_BACKUP_KEEP = 5
/** 旧备份压缩级别：1 比 6 快 3 倍，压缩率只差 ~14%（185MB → 22.4MB vs 19.3MB）。 */
const BACKUP_GZIP_LEVEL = 1

function backupsDir(dbPath: string): string {
  const dir = join(dirname(dbPath), 'backups')
  mkdirSync(dir, { recursive: true, mode: 0o700 })
  return dir
}

/** 导出只为测试（保留策略 / 压缩策略都要能单测）。 */
export function pruneBackups(dir: string, pattern: RegExp, keep: number): void {
  // `numeric: true` 让版本号按**数字**比：「xueba-v13-…」字典序排在「xueba-v6-…」前面，
  // 直接 sort 会把刚做的 v13 迁移前备份当成最旧的删掉（2026-11-23 踩过）。
  const files = readdirSync(dir)
    .filter((name) => pattern.test(name))
    .sort((a, b) => a.localeCompare(b, 'en', { numeric: true }))
  for (const name of files.slice(0, Math.max(0, files.length - keep))) {
    const file = join(dir, name)
    rmSync(file, { force: true })
    rmSync(`${file}.verified`, { force: true })
  }
}

/**
 * 「这份备份已经校验过」的侧标（`<file>.verified`，内容是「大小:mtime」）。
 *
 * 为什么要有：校验一份 128MB 的备份 = `PRAGMA quick_check` 扫全库，慢盘上十几秒。
 * 以前**每次启动**都要把当天那份重新校验一遍，等于白扫 128MB。
 * 现在只在校验通过时记一笔；文件没被换过（大小/mtime 没变）就不重复扫。
 */
function markerPath(file: string): string {
  return `${file}.verified`
}

function fileStamp(file: string): string | null {
  try {
    const st = statSync(file)
    return `${st.size}:${Math.round(st.mtimeMs)}`
  } catch {
    return null
  }
}

function recordVerified(file: string): void {
  const stamp = fileStamp(file)
  if (!stamp) return
  try {
    writeFileSync(markerPath(file), stamp, { mode: 0o600 })
  } catch {
    // 写不了侧标就退回「每次都校验」，不影响正确性
  }
}

function alreadyVerified(file: string): boolean {
  try {
    return readFileSync(markerPath(file), 'utf8').trim() === fileStamp(file)
  } catch {
    return false
  }
}

/** 备份写完立刻用只读连接做 quick_check；坏文件不能当成“还有一份”。 */
function verifyBackup(file: string, DatabaseSync: DatabaseSyncCtor | null): void {
  if (!DatabaseSync) return
  let db: DatabaseSync | null = null
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
  recordVerified(file)
}

function vacuumInto(db: DatabaseSync, file: string, DatabaseSync: DatabaseSyncCtor | null): void {
  const target = file.replace(/'/g, "''")
  rmSync(markerPath(file), { force: true })
  db.exec(`VACUUM INTO '${target}'`)
  try {
    chmodSync(file, 0o600)
  } catch {
    // Windows 忽略权限位
  }
  try {
    // verifyBackup 成功时会顺手记下 .verified 侧标，下次启动不用再扫
    verifyBackup(file, DatabaseSync)
  } catch (e) {
    // 校验失败的备份没有保留价值，删掉让下次重试，别让它占着“当天已有备份”的位置。
    rmSync(file, { force: true })
    throw e
  }
}

/**
 * 把**旧**的备份压成 `.db.gz`（今天的、刚做的那份不动）。
 *
 * 为什么不一生成就压：`backupDaily` 靠 `verifyBackup`（`PRAGMA quick_check`）来判断
 * 「当天那份是不是好的」，压过的文件没法再 quick_check。所以策略是：
 *   - 当天那份保持 `.db`，启动时的校验逻辑原样有效；
 *   - 隔天的（且做出来超过 1 小时、确认没人还在写）压成 `.db.gz`，185MB → ~22MB；
 *   - 每次只压一个，摊到 30 分钟的 tick 里，不阻塞启动。
 * 要恢复旧备份：`gunzip xueba-daily-YYYY-MM-DD.db.gz` 后照常拷回去即可。
 */
export function compressOldBackups(dir: string, today: string): string | null {
  const hourAgo = Date.now() - 60 * 60 * 1000
  const candidates = readdirSync(dir)
    .filter((name) => /^xueba-(daily|v\d+)-.*\.db$/.test(name))
    .filter((name) => !name.startsWith(`xueba-daily-${today}.db`))
    .filter((name) => {
      try {
        return statSync(join(dir, name)).mtimeMs < hourAgo
      } catch {
        return false
      }
    })
    .sort()
  const name = candidates[0]
  if (!name) return null
  const file = join(dir, name)
  try {
    // 先写 .gz 再删原文件：压缩中途失败也不会两边都没有
    writeFileSync(`${file}.gz`, gzipSync(readFileSync(file), { level: BACKUP_GZIP_LEVEL }))
    rmSync(file, { force: true })
    rmSync(markerPath(file), { force: true })
    return `${file}.gz`
  } catch (e) {
    console.warn('[sqlite] 旧备份压缩失败（保留原文件）：', e instanceof Error ? e.message : e)
    return null
  }
}

/**
 * schema 升级前把整库 VACUUM 成独立文件，放在 `data/backups/`。
 * 迁移只增不删，但真出事故时至少要能回到升级前；保留最近 5 份。
 */
export function backupBeforeMigration(
  db: DatabaseSync,
  dbPath: string,
  version: number,
  DatabaseSync: DatabaseSyncCtor | null,
): string | null {
  if (version <= 0 || version >= SCHEMA_VERSION) return null
  const dir = backupsDir(dbPath)
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const file = join(dir, `xueba-v${version}-${stamp}.db`)
  vacuumInto(db, file, DatabaseSync)
  pruneBackups(dir, /^xueba-v\d+-.*\.db(\.gz)?$/, DB_BACKUP_KEEP)
  return file
}

/**
 * 每天首次打开已有库时做一份整库备份。
 *
 * 不是替代每日整库备份：这个防「整个文件被误删/改坏后没有第二份」。
 * 只在本进程当天第一次打开时做；已经存在当天文件就跳过。
 */
export function backupDaily(
  db: DatabaseSync,
  dbPath: string,
  version: number,
  DatabaseSync: DatabaseSyncCtor | null,
): string | null {
  if (version <= 0) return null
  const dir = backupsDir(dbPath)
  const day = localDayKey()
  const file = join(dir, `xueba-daily-${day}.db`)
  if (existsSync(file)) {
    // 校验过且文件没被换过就不再扫：128MB 的 quick_check 在慢盘上要十几秒，
    // 以前每次启动都白扫一遍。
    if (alreadyVerified(file)) return null
    try {
      // 已有的当天备份也要验；磁盘写坏/拷坏时重新做一份，不能因为文件名在就跳过。
      verifyBackup(file, DatabaseSync)
      return null
    } catch (e) {
      console.warn('[sqlite] 当天备份校验失败，重新生成：', e instanceof Error ? e.message : e)
      rmSync(file, { force: true })
      rmSync(markerPath(file), { force: true })
    }
  }
  vacuumInto(db, file, DatabaseSync)
  pruneBackups(dir, /^xueba-daily-.*\.db(\.gz)?$/, DAILY_BACKUP_KEEP)
  return file
}

/**
 * 长开进程也要每天有备份：启动时做一次，之后每 30 分钟检查日期。
 * 跨过午夜且当天还没备份时自动补一份；`unref` 不阻止进程退出。
 */
export function startDailyBackup(
  db: DatabaseSync,
  dbPath: string,
  DatabaseSync: DatabaseSyncCtor | null,
): () => void {
  const tick = () => {
    try {
      const file = backupDaily(db, dbPath, SCHEMA_VERSION, DatabaseSync)
      if (file) console.info(`[sqlite] 每日备份：${file}`)
      // 顺手把隔天的旧备份压掉（一次只压一个，不阻塞）
      const zipped = compressOldBackups(backupsDir(dbPath), localDayKey())
      if (zipped) console.info(`[sqlite] 旧备份已压缩：${zipped}`)
    } catch (e) {
      console.warn('[sqlite] 每日备份失败：', e instanceof Error ? e.message : e)
    }
  }
  const timer = setInterval(tick, 30 * 60 * 1000)
  timer.unref?.()
  return () => clearInterval(timer)
}
