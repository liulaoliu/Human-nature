import { createRequire } from 'node:module'
import type { DatabaseSync as SqliteDatabase } from 'node:sqlite'
import { describe, expect, it } from 'vitest'
import { loadLearning, writeLearning } from './sqliteLearning.ts'
import { ensureSchema } from './sqliteStore.ts'

/**
 * 前端与数据库之间的**契约测试**：写作记录的 `source` 白名单两端必须是同一份。
 *
 * 为什么要有它：`src/core/writing.ts` 的 `WRITING_SOURCES` 是「界面认哪些来源」的事实来源，
 * 服务端读回时也有一份（`server/sqliteLearning.ts` 顶部的 `WRITING_SOURCES`）。
 * 2026-10-30 两边漂过一次：前端加了 `production`，服务端没跟上，于是产出训练的历史
 * 存进去再读回来就丢了来源，界面按「普通仿写」显示 —— 数据没丢，但归类错了，没人发现。
 *
 * 这里故意把前端那五个值写死（服务端程序不该 import src，两层各跑各的 tsc）：
 * 前端再加来源时，把新值补进这个数组，测试就会立刻告诉你服务端还没认。
 */
const FRONTEND_SOURCES = ['writing', 'goldenSentence', 'goldenExam', 'goldenError', 'production'] as const

const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as {
  DatabaseSync: new (path: string) => SqliteDatabase
}

function freshDb(): SqliteDatabase {
  const db = new DatabaseSync(':memory:')
  ensureSchema(db)
  return db
}

describe('写作来源白名单：前端与数据库一致', () => {
  it('前端列举的每个来源，写进库再读回来都还在', () => {
    const db = freshDb()
    const history = FRONTEND_SOURCES.map((source, i) => ({
      at: `2026-11-0${i + 1}T02:00:00.000Z`,
      articleId: 'saved:1',
      model: 'gpt',
      text: `第 ${i + 1} 条`,
      feedback: {},
      source,
    }))
    writeLearning(db, { writingHistory: history })

    const back = loadLearning(db).writingHistory
    expect(back).toHaveLength(history.length)
    // 读回是倒序（at DESC），翻回正序再比
    expect([...back].reverse().map((r) => r.source)).toEqual([...FRONTEND_SOURCES])
    db.close()
  })

  it('白名单外的来源读回来是 undefined（脏数据不当成某个来源）', () => {
    const db = freshDb()
    writeLearning(db, {
      writingHistory: [
        { at: '2026-11-01T02:00:00.000Z', articleId: '', model: '', text: 'x', feedback: {}, source: 'bogus' },
      ],
    })
    expect(loadLearning(db).writingHistory[0]?.source).toBeUndefined()
    db.close()
  })
})
