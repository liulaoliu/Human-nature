import { parentPort, workerData } from 'node:worker_threads'
import { runMaintenance, type MaintenanceReport } from './sqliteMaintenance.ts'

/**
 * 后台维护线程入口。
 *
 * 只做一件事：把库路径交给 `runMaintenance`，把结果回传给主线程。
 * 逻辑（和测试）都在 `sqliteMaintenance.ts`，这里不写业务。
 */
const dbPath = String((workerData as { dbPath?: unknown } | null)?.dbPath ?? '')
const report: MaintenanceReport = dbPath ? runMaintenance(dbPath) : { ok: false, steps: [] }
parentPort?.postMessage(report)
