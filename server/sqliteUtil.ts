/** SQLite 存储共用的小工具：不依赖具体表，词库/文章/学习记录都能用。 */
import type { DatabaseSync } from 'node:sqlite'

export function nowIso(): string {
  return new Date().toISOString()
}

/** 包在 BEGIN IMMEDIATE 事务里跑 fn；fn 抛错就 ROLLBACK 后原样重抛。 */
export function tx<T>(db: DatabaseSync, fn: () => T): T {
  db.exec('BEGIN IMMEDIATE')
  try {
    const out = fn()
    db.exec('COMMIT')
    return out
  } catch (e) {
    try {
      db.exec('ROLLBACK')
    } catch {
      // COMMIT 之后再 ROLLBACK 会抛「no transaction」，这里本来就只是在
      // 尽力恢复连接状态；重抛的才是原始错误。
    }
    throw e
  }
}

/**
 * 写 SQLite TEXT 列的统一出口：null/undefined 存 NULL，其余 String() 化。
 * 参数是 unknown：调用方喂的是 JSON 字段或 SQLite row 值（规范 §4.2 外部输入），
 * 只认「null/undefined → NULL，string 原样，别的 ToString」这一条规则。
 */
export function text(v: unknown): string | null {
  if (v === undefined || v === null) return null
  return typeof v === 'string' ? v : String(v)
}

/** 读数字：Number() 不出有限值（undefined / 非数字串 / null 之外的怪值）就走兜底。 */
export function num(v: unknown, fallback = 0): number {
  const n = Number(v)
  return Number.isFinite(n) ? n : fallback
}

/** JSON 数组字段守卫：是数组就原样返回，否则空数组（不把坏数据变成 null）。 */
export function list<T = unknown>(v: unknown): T[] {
  return Array.isArray(v) ? v : []
}
