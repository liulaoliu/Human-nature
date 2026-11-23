import { createRequire } from 'node:module'
import type { DatabaseSync as SqliteDatabase } from 'node:sqlite'
import { describe, expect, it } from 'vitest'
import { SCHEMA_V14 } from './sqliteSchema.ts'
import { ensureSchema, SCHEMA_VERSION } from './sqliteStore.ts'
import { ANSWER_EVENT_CLIENT_CAP, loadLearning } from './sqliteLearning.ts'

/**
 * 答题事件的两条硬约束（2026-11-23 事故）：
 *
 *   - **同一内容只存一条**：`answer_events` 是 append-only，同步时靠唯一索引去重；
 *     v7 建索引的 DDL 只对新建库生效，老库一直没有这个索引，于是每次整份同步都追加一遍。
 *     实测 1209 条真事件被写成 484895 条，库 135MB，`GET /learning` 一次回 69MB JSON。
 *   - **回客户端有条数上限**：前端 localStorage 本来也只留 5000 条，服务端没必要回全量。
 *
 * 这两条任一条破了，首屏都会慢到“打不开”，所以单独钉死。
 */

const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as {
  DatabaseSync: new (path: string) => SqliteDatabase
}

const freshDb = (): SqliteDatabase => {
  const db = new DatabaseSync(':memory:')
  ensureSchema(db)
  return db
}

const insertEvent = (db: SqliteDatabase, at: string, questionId: string): void => {
  // 和真实写入路径一致：append-only + INSERT OR IGNORE，去重全靠唯一索引
  db.prepare(
    'INSERT OR IGNORE INTO answer_events (at, day, article_id, source, kind, cat, correct, question_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
  ).run(at, at.slice(0, 10), 'a1', 'golden', 'fill', 'golden', 1, questionId)
}

const countEvents = (db: SqliteDatabase): number =>
  Number(db.prepare('SELECT COUNT(*) AS n FROM answer_events').get()?.n ?? 0)

describe('v14：答题事件去重 + 唯一索引', () => {
  it('老库里的重复事件只留最早一条，补上唯一索引后重复插入被忽略', () => {
    const db = freshDb()
    // 模拟老库：v7 之后新建的索引它没有
    db.exec('DROP INDEX idx_answer_events_key')
    for (let i = 0; i < 5; i++) insertEvent(db, '2026-11-03T01:00:00.000Z', 'q1')
    insertEvent(db, '2026-11-03T01:00:00.000Z', 'q2')
    expect(countEvents(db)).toBe(6)

    // 老库版本停在 13，再打开时应该跑 v14
    db.exec('PRAGMA user_version = 13')
    expect(ensureSchema(db)).toBe(SCHEMA_VERSION)
    expect(countEvents(db)).toBe(2)

    // 索引真的生效：同样的内容再同步一次不会又变多
    insertEvent(db, '2026-11-03T01:00:00.000Z', 'q1')
    insertEvent(db, '2026-11-03T01:00:00.000Z', 'q2')
    expect(countEvents(db)).toBe(2)
    db.close()
  })

  it('question_id 为空的重复行也按同一条算（NULL 不参与唯一性，迁移里统一成空串）', () => {
    const db = freshDb()
    db.exec('DROP INDEX idx_answer_events_key')
    const ins = db.prepare(
      'INSERT INTO answer_events (at, day, article_id, source, kind, cat, correct, question_id) VALUES (?, ?, ?, ?, ?, ?, ?, NULL)',
    )
    ins.run('2026-11-03T01:00:00.000Z', '2026-11-03', 'a1', 'quiz', 'vocab', 'quiz', 0)
    ins.run('2026-11-03T01:00:00.000Z', '2026-11-03', 'a1', 'quiz', 'vocab', 'quiz', 0)

    db.exec(SCHEMA_V14)

    expect(countEvents(db)).toBe(1)
    db.close()
  })
})

describe('loadLearning：答题事件回客户端的条数上限', () => {
  it(`最多回 ${ANSWER_EVENT_CLIENT_CAP} 条，且是最新的那批（时间正序）`, () => {
    const db = freshDb()
    const total = ANSWER_EVENT_CLIENT_CAP + 10
    db.exec('BEGIN')
    for (let i = 0; i < total; i++) {
      const at = new Date(Date.UTC(2026, 0, 1, 0, 0, i)).toISOString()
      insertEvent(db, at, `q${i}`)
    }
    db.exec('COMMIT')

    const client = loadLearning(db, { answerEventLimit: ANSWER_EVENT_CLIENT_CAP }).answerEvents
    expect(client).toHaveLength(ANSWER_EVENT_CLIENT_CAP)
    // 丢掉的是最早的 10 条；返回仍按 at 正序
    expect(client[0]?.questionId).toBe('q10')
    expect(client.at(-1)?.questionId).toBe(`q${total - 1}`)

    // 导出 / 重建派生统计走全量
    expect(loadLearning(db).answerEvents).toHaveLength(total)
    db.close()
  })

  it('不传上限时保持原来的行为（全量、正序）', () => {
    const db = freshDb()
    insertEvent(db, '2026-11-03T01:00:00.000Z', 'q1')
    insertEvent(db, '2026-11-03T02:00:00.000Z', 'q2')

    expect(loadLearning(db).answerEvents.map((e) => e.questionId)).toEqual(['q1', 'q2'])
    db.close()
  })
})
