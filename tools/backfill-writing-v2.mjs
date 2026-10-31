#!/usr/bin/env node
/**
 * 一次性回填：把旧批改记录升级到契约 v2。
 *
 * 旧记录只有 { scores, issues:[{original,suggestion,reason}], polished, summary }，
 * 没有 rule / key / severity，也没有 recommendations。新代码只分析 v2，
 * 所以这里用 `classifyLegacyIssue()` 把每条 issue 映射到闭集标签，写入 version:2。
 *
 * 设计原则：
 * - 先 `VACUUM INTO` 备份，再在一个事务里改；失败自动回滚，备份仍在。
 * - 幂等：version 已经是 2 的记录跳过；重复跑不会把推荐清空。
 * - 不替 AI 编 recommendations：旧记录统一补 `recommendations: []`，
 *   推荐从下一次批改开始产生。
 *
 * 用法：
 *   node tools/backfill-writing-v2.mjs --dry-run
 *   node tools/backfill-writing-v2.mjs
 *   node tools/backfill-writing-v2.mjs --db data/xueba.db --no-backup
 */
import { existsSync, mkdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { DatabaseSync } from 'node:sqlite'
import { upgradeWritingFeedback } from '../src/core/writingBackfill.ts'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/** 兼容旧名字：纯映射已挪到 `src/core/writingBackfill.ts`。 */
export const upgradeFeedbackJson = upgradeWritingFeedback


function backupPathFor(dbPath) {
  const dir = join(root, 'data', 'backups')
  mkdirSync(dir, { recursive: true })
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..*$/, '').replace('T', '-')
  return join(dir, `xueba-before-writing-v2-${stamp}.db`)
}

/**
 * 对已打开的库执行回填。
 * @returns {{ scanned:number, updated:number, skipped:number, failed:number, issues:number, inferred:number, dropped:number }}
 */
export function backfillDatabase(db, { dryRun = false } = {}) {
  const table = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'writing_records'")
    .get()
  if (!table) throw new Error('writing_records 表不存在')
  const rows = db.prepare('SELECT id, at, feedback_json FROM writing_records ORDER BY id').all()
  const plan = []
  const stats = {
    scanned: rows.length,
    updated: 0,
    skipped: 0,
    failed: 0,
    issues: 0,
    inferred: 0,
    dropped: 0,
  }
  for (const row of rows) {
    const up = upgradeFeedbackJson(String(row.feedback_json ?? ''))
    if (!up) {
      stats.skipped++
      continue
    }
    stats.issues += up.feedback.issues.length
    stats.inferred += up.inferred
    stats.dropped += up.dropped
    plan.push({ id: row.id, at: row.at, json: JSON.stringify(up.feedback), issues: up.feedback.issues })
  }
  stats.updated = plan.length
  if (dryRun) return { stats, plan }

  const update = db.prepare('UPDATE writing_records SET feedback_json = ? WHERE id = ?')
  db.exec('BEGIN IMMEDIATE')
  try {
    for (const item of plan) update.run(item.json, item.id)
    db.exec('COMMIT')
  } catch (e) {
    db.exec('ROLLBACK')
    throw e
  }
  return { stats, plan }
}

function parseArgs(argv) {
  const args = { db: join(root, 'data', 'xueba.db'), dryRun: false, backup: true }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--dry-run') args.dryRun = true
    else if (a === '--no-backup') args.backup = false
    else if (a === '--db') args.db = resolve(argv[++i] ?? '')
    else if (a.startsWith('--db=')) args.db = resolve(a.slice(5))
    else if (a === '--help' || a === '-h') args.help = true
    else throw new Error(`未知参数：${a}`)
  }
  return args
}

function main() {
  const args = parseArgs(process.argv.slice(2))
  if (args.help) {
    console.log('用法：node tools/backfill-writing-v2.mjs [--db data/xueba.db] [--dry-run] [--no-backup]')
    return
  }
  if (!existsSync(args.db)) throw new Error(`找不到数据库：${args.db}`)
  if (args.backup && !args.dryRun) {
    const backup = backupPathFor(args.db)
    const db = new DatabaseSync(args.db)
    try {
      db.exec(`VACUUM INTO '${backup.replaceAll("'", "''")}'`)
    } finally {
      db.close()
    }
    console.log(`已备份：${backup}`)
  }
  const db = new DatabaseSync(args.db)
  try {
    const { stats, plan } = backfillDatabase(db, { dryRun: args.dryRun })
    console.log(
      `${args.dryRun ? '[dry-run] ' : ''}扫描 ${stats.scanned} 条，回填 ${stats.updated} 条，跳过 ${stats.skipped} 条；` +
        `issues ${stats.issues} 条（自动归类 ${stats.inferred}，丢弃 ${stats.dropped}）`,
    )
    const plain = plan.filter((p) => !p.at).length
    if (plain) console.log(`注意：${plain} 条缺时间戳，界面可能无法按时间排序`)
    if (args.dryRun && plan.length) {
      console.log('样例：')
      for (const p of plan.slice(0, 3)) {
        for (const i of p.issues.slice(0, 3)) console.log(`  ${i.original || '∅'} → ${i.suggestion} [${i.rule}] ${i.severity}`)
      }
    }
    const check = db.prepare('PRAGMA integrity_check').get()
    console.log(`integrity_check: ${check?.integrity_check ?? '?'}`)
  } finally {
    db.close()
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main()
  } catch (e) {
    console.error(String(e?.message ?? e))
    process.exitCode = 1
  }
}
