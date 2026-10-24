import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, readFileSync, readdirSync, statSync, utimesSync, writeFileSync } from 'node:fs'
import { gunzipSync } from 'node:zlib'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { compressOldBackups, pruneBackups } from './sqliteBackup.ts'

/**
 * 备份目录的两条策略：
 *   - `pruneBackups`：保留最近 N 份（`.db` 和压缩后的 `.db.gz` 一起算）；
 *   - `compressOldBackups`：只压**旧的**，当天那份保持 `.db` 以便 `PRAGMA quick_check`。
 */

const dir = () => mkdtempSync(join(tmpdir(), 'xueba-backup-'))
const touch = (d, name, content = 'x') => writeFileSync(join(d, name), content)

/** 把 mtime 往前调，模拟「昨天/上个月做的备份」。 */
const age = (file, ms) => {
  const t = new Date(Date.now() - ms)
  utimesSync(file, t, t)
}

afterEach(() => {
  // 临时目录留在系统 temp 里，由系统清理
})

describe('pruneBackups：保留最近 N 份', () => {
  it('.db 与 .db.gz 一起计入保留数（压缩不能变成「多留一份」）', () => {
    const d = dir()
    for (const day of ['01', '02', '03', '04', '05']) touch(d, `xueba-daily-2026-10-${day}.db`)
    touch(d, 'xueba-daily-2026-10-06.db.gz')
    touch(d, 'xueba-daily-2026-10-07.db.gz')

    pruneBackups(d, /^xueba-daily-.*\.db(\.gz)?$/, 5)

    const left = readdirSync(d).sort()
    expect(left).toHaveLength(5)
    // 留下的是最新的 5 个（03..07），最老的 01/02 被删
    expect(left).toEqual([
      'xueba-daily-2026-10-03.db',
      'xueba-daily-2026-10-04.db',
      'xueba-daily-2026-10-05.db',
      'xueba-daily-2026-10-06.db.gz',
      'xueba-daily-2026-10-07.db.gz',
    ])
  })
})

describe('compressOldBackups：只压旧的，当天的不动', () => {
  it('隔天的 .db 压成 .db.gz 并删原文件，内容能解回来', () => {
    const d = dir()
    const old = join(d, 'xueba-daily-2026-10-01.db')
    writeFileSync(old, 'FAKE-DB-CONTENT')
    age(old, 48 * 60 * 60 * 1000) // 两天前

    const out = compressOldBackups(d, '2026-10-23')

    expect(out).toBe(`${old}.gz`)
    expect(readdirSync(d).sort()).toEqual(['xueba-daily-2026-10-01.db.gz'])
    expect(gunzipSync(readFileSync(`${old}.gz`)).toString('utf8')).toBe('FAKE-DB-CONTENT')
  })

  it('当天那份不压（它还要能 quick_check）', () => {
    const d = dir()
    const today = join(d, 'xueba-daily-2026-10-23.db')
    writeFileSync(today, 'TODAY')
    age(today, 48 * 60 * 60 * 1000) // 就算 mtime 很老，只要是「今天这份」也不压

    expect(compressOldBackups(d, '2026-10-23')).toBeNull()
    expect(readdirSync(d)).toEqual(['xueba-daily-2026-10-23.db'])
  })

  it('刚做出来不到 1 小时的不压（可能还有进程在写）', () => {
    const d = dir()
    const fresh = join(d, 'xueba-v1-2026-10-23T10-00-00-000Z.db')
    writeFileSync(fresh, 'FRESH')

    expect(compressOldBackups(d, '2026-10-23')).toBeNull()
    expect(statSync(fresh).size).toBeGreaterThan(0)
  })

  it('一次只压一个（摊到 30 分钟的 tick 里，不阻塞启动）', () => {
    const d = dir()
    for (const day of ['01', '02', '03']) {
      const f = join(d, `xueba-daily-2026-10-${day}.db`)
      writeFileSync(f, 'X')
      age(f, 72 * 60 * 60 * 1000)
    }
    compressOldBackups(d, '2026-10-23')
    const gz = readdirSync(d).filter((n) => n.endsWith('.gz'))
    const db = readdirSync(d).filter((n) => n.endsWith('.db'))
    expect(gz).toHaveLength(1)
    expect(db).toHaveLength(2)
  })
})
