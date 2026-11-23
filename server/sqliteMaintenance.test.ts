import { existsSync, mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import type { DatabaseSync as SqliteDatabase } from 'node:sqlite'
import { afterEach, describe, expect, it } from 'vitest'
import { runMaintenance } from './sqliteMaintenance.ts'
import { ensureSchema } from './sqliteStore.ts'

/**
 * 后台维护必须满足两条：
 *   1. 首次打开就能跑完（不抛错），并且真的做出当天的整库备份；
 *   2. **第二次不重复扫/重复写**（否则每次启动都白读 128MB，慢盘上又是十几秒）。
 *
 * 这些以前在 `openStore` 里同步跑，把 dev server 的事件循环堵死 —— 见
 * docs/PERF-NOTES.md §12。
 */

const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as {
  DatabaseSync: new (path: string) => SqliteDatabase
}

const dirs: string[] = []
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function makeDb(): { dir: string; dbPath: string } {
  const dir = mkdtempSync(join(tmpdir(), 'xueba-maint-'))
  dirs.push(dir)
  const dbPath = join(dir, 'xueba.db')
  const db = new DatabaseSync(dbPath)
  ensureSchema(db)
  db.close()
  return { dir, dbPath }
}

describe('runMaintenance：整库维护', () => {
  it('首次维护做出当天备份，并记下 .verified 侧标', () => {
    const { dir, dbPath } = makeDb()
    const report = runMaintenance(dbPath)

    expect(report.ok).toBe(true)
    expect(report.steps.map((s) => s.name)).toEqual([
      'integrity',
      'snapshots',
      'reclaim',
      'daily-backup',
      'compress-old',
    ])
    expect(report.steps.every((s) => s.ok)).toBe(true)

    const backups = readdirSync(join(dir, 'backups'))
    const daily = backups.find((n) => n.startsWith('xueba-daily-') && n.endsWith('.db'))
    expect(daily, '没有生成当天备份').toBeTruthy()
    // 侧标存在 → 下次启动不用再 quick_check（128MB 的扫描）
    expect(backups).toContain(`${daily}.verified`)
  })

  it('第二次维护不重写当天备份（mtime 不变）', () => {
    const { dir, dbPath } = makeDb()
    runMaintenance(dbPath)
    const backup = readdirSync(join(dir, 'backups')).find((n) => n.endsWith('.db'))
    if (!backup) throw new Error('第一次没做出备份')
    const file = join(dir, 'backups', backup)
    const before = statSync(file).mtimeMs

    const second = runMaintenance(dbPath)

    expect(second.ok).toBe(true)
    const step = second.steps.find((s) => s.name === 'daily-backup')
    expect(step?.detail).toBe('当天已有备份')
    expect(statSync(file).mtimeMs).toBe(before)
    expect(existsSync(file)).toBe(true)
  })

  it('库文件坏掉时报 ok:false，而不是把异常抛到主线程', () => {
    const dir = mkdtempSync(join(tmpdir(), 'xueba-maint-'))
    dirs.push(dir)
    const dbPath = join(dir, 'xueba.db')
    writeFileSync(dbPath, 'not a sqlite database at all')

    const report = runMaintenance(dbPath)

    expect(report.ok).toBe(false)
    expect(report.steps.some((s) => !s.ok)).toBe(true)
  })
})
