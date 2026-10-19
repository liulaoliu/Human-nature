/** SQLite 存储共用的小工具：不依赖具体表，词库/文章/学习记录都能用。 */

export function nowIso() {
  return new Date().toISOString()
}

export function tx(db, fn) {
  db.exec('BEGIN IMMEDIATE')
  try {
    const out = fn()
    db.exec('COMMIT')
    return out
  } catch (e) {
    try {
      db.exec('ROLLBACK')
    } catch {
      // ignore
    }
    throw e
  }
}

export function text(v) {
  if (v === undefined || v === null) return null
  return typeof v === 'string' ? v : String(v)
}

export function num(v, fallback = 0) {
  const n = Number(v)
  return Number.isFinite(n) ? n : fallback
}

export function list(v) {
  return Array.isArray(v) ? v : []
}
