import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { Worker } from 'node:worker_threads'
import type { DatabaseSync } from 'node:sqlite'
import { assertDatabaseHealthy, maintainSnapshots, reclaimSpace } from './sqliteStore.ts'
import { backupDaily, compressOldBackups } from './sqliteBackup.ts'
import { localDayKey } from './localDate.ts'
import { SCHEMA_VERSION } from './sqliteSchema.ts'

/**
 * 数据库的**后台维护**：完整性检查、整理历史快照、回收空间、每日整库备份、压缩旧备份。
 *
 * 为什么不在 `openStore` 里同步做（2026-11-23 踩的坑）：
 *   - `PRAGMA quick_check` 和 `VACUUM INTO` 都要**读/写整个库**。本库 135MB，
 *     慢盘上要几十秒到几分钟；以前这些都在「首个 /api/store 请求」里同步跑，
 *     node:sqlite 是同步 API，事件循环一堵，连 `GET /` 都要排队 —— 网页表现为“打不开”。
 *   - 现在挪进 worker 线程：主线程只负责建 schema（必须同步），维护在后台慢慢跑，
 *     跑多久都不影响首屏。
 *
 * 单独成文件的另一个原因：worker 入口要能被测试直接调用（`runMaintenance`），
 * 调度（`startBackgroundMaintenance`）只是接线。
 */

type DatabaseSyncCtor = typeof DatabaseSync

const require = createRequire(import.meta.url)
let DatabaseSyncCtor: DatabaseSyncCtor | null = null
try {
  ;({ DatabaseSync: DatabaseSyncCtor } = require('node:sqlite'))
} catch {
  // Node 20 没有 node:sqlite：维护直接跳过（openStore 也会返回 null，前端回退 IndexedDB）
}

export interface MaintenanceStep {
  name: string
  ok: boolean
  /** 成功时的说明（生成了哪个备份 / 回收了多少页）或失败原因。 */
  detail?: string
}

export interface MaintenanceReport {
  ok: boolean
  steps: MaintenanceStep[]
}

function step(report: MaintenanceReport, name: string, run: () => string | void): void {
  try {
    const detail = run()
    report.steps.push(detail ? { name, ok: true, detail } : { name, ok: true })
  } catch (e) {
    report.ok = false
    report.steps.push({ name, ok: false, detail: e instanceof Error ? e.message : String(e) })
  }
}

/**
 * 跑一遍维护。**同步、慢、会读写整库**，只允许在 worker（或测试）里调用。
 *
 * 每一步独立 `try`：完整性检查失败也照样尝试备份，别让一处报错把其余步骤全跳过。
 * 打开自己的连接（不是主线程那个），完成后关掉 —— `VACUUM` 需要独占，主连接开着也不影响
 * 备份/检查（WAL 下读快照），只是 `VACUUM` 可能因 BUSY 被跳过，下次再来。
 */
export function runMaintenance(dbPath: string, Ctor: DatabaseSyncCtor | null = DatabaseSyncCtor): MaintenanceReport {
  const report: MaintenanceReport = { ok: true, steps: [] }
  if (!Ctor) return report
  let db: DatabaseSync | null = null
  try {
    db = new Ctor(dbPath)
    const conn = db
    conn.exec('PRAGMA busy_timeout = 5000')

    step(report, 'integrity', () => {
      assertDatabaseHealthy(conn)
      return 'quick_check = ok'
    })
    step(report, 'snapshots', () => {
      maintainSnapshots(conn)
    })
    step(report, 'reclaim', () => {
      reclaimSpace(conn)
    })
    step(report, 'daily-backup', () => {
      const file = backupDaily(conn, dbPath, SCHEMA_VERSION, Ctor)
      return file ? `备份：${file}` : '当天已有备份'
    })
    step(report, 'compress-old', () => {
      const file = compressOldBackups(join(dirname(dbPath), 'backups'), localDayKey())
      return file ? `压缩：${file}` : '没有需要压缩的旧备份'
    })
  } catch (e) {
    report.ok = false
    report.steps.push({ name: 'open', ok: false, detail: e instanceof Error ? e.message : String(e) })
  } finally {
    try {
      db?.close()
    } catch {
      // 关不掉也不影响下一次开
    }
  }
  return report
}

/** 首次维护延迟：让首屏请求先跑完，别跟它抢磁盘。 */
export const MAINTENANCE_FIRST_DELAY_MS = 8_000
/** 长开进程也要每天有备份：跨过午夜后由这一跳补上。 */
export const MAINTENANCE_INTERVAL_MS = 30 * 60 * 1000

const started = new Set<string>()

/** 每个库路径只调度一次（`handleStoreApi` 每个请求都会走，必须幂等）。 */
export function startBackgroundMaintenance(dbPath: string, delayMs = MAINTENANCE_FIRST_DELAY_MS): void {
  if (!DatabaseSyncCtor || started.has(dbPath)) return
  started.add(dbPath)
  const run = () => spawnMaintenanceWorker(dbPath)
  const first = setTimeout(run, Math.max(0, delayMs))
  first.unref?.()
  const timer = setInterval(run, MAINTENANCE_INTERVAL_MS)
  timer.unref?.()
}

function spawnMaintenanceWorker(dbPath: string): void {
  try {
    // 用 `import.meta.url` 拼绝对路径：dev 里 Vite 给每个被 bundle 的模块注入了各自的原始 URL，
    // 生产里是原生 ESM，两种都指向仓库里的 server/sqliteMaintenanceWorker.ts。
    const worker = new Worker(new URL('./sqliteMaintenanceWorker.ts', import.meta.url), {
      workerData: { dbPath },
    })
    worker.once('message', (report: MaintenanceReport) => {
      if (!report.ok) {
        const failed = report.steps.filter((s) => !s.ok).map((s) => `${s.name}: ${s.detail ?? ''}`)
        console.warn('[sqlite] 后台维护有问题：', failed.join('; '))
      }
    })
    worker.once('error', (e) => {
      console.warn('[sqlite] 后台维护线程失败：', e instanceof Error ? e.message : e)
    })
    // 维护不该拖住进程退出（服务关闭时正在备份也没关系，下一次启动会补）
    worker.unref()
  } catch (e) {
    console.warn('[sqlite] 后台维护启动失败：', e instanceof Error ? e.message : e)
  }
}

/** 测试用：清掉“已调度”标记，避免用例之间互相影响。 */
export function resetMaintenanceScheduleForTest(): void {
  started.clear()
}
