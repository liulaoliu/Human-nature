import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import type { DatabaseSync as SqliteDatabase } from 'node:sqlite'
import { afterEach, describe, expect, it } from 'vitest'
import { SCHEMA_V1 } from './sqliteSchema.ts'
import { ensureSchema, openStore, SCHEMA_VERSION, VocabConflictError } from './sqliteStore.ts'
import { loadLearning, writeLearning } from './sqliteLearning.ts'

/**
 * 服务端持久层的测试：直接开 `:memory:` 库，不走 HTTP、不碰真实磁盘。
 *
 * 为什么单独测这一层：`data/xueba.db` 是用户唯一的资产（词库一万多条、学习记录全在里面），
 * 而前端 `src/adapters/*.test.ts` 用的是 `mockStore` 伪造 fetch——真实 SQL 从来没人断言过。
 * 这里锁三件事：schema 迁移、学习记录往返、文章/词库的写读一致性。
 */

// 和 server/sqliteStore.ts 一样走 createRequire：vite 会把 `node:sqlite` 当普通包去解析，静态 import 直接失败。
const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as {
  DatabaseSync: new (path: string) => SqliteDatabase
}

const tmpDirs: string[] = []

afterEach(() => {
  for (const dir of tmpDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function freshDb(): SqliteDatabase {
  return new DatabaseSync(':memory:')
}

function tableNames(db: SqliteDatabase): Set<string> {
  return new Set(
    db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
      .all()
      .map((r) => String(r.name)),
  )
}

function userVersion(db: SqliteDatabase): number {
  return Number(db.prepare('PRAGMA user_version').get()?.user_version ?? 0)
}

/** 一份最小的学习记录：每个 section 至少一条，其余给空数组。 */
function learningFixture() {
  return {
    practice: [{ at: '2026-11-01T02:00:00.000Z', kind: 'vocab', total: 20, correct: 18, articleId: 'saved:1' }],
    mistakes: [
      {
        id: 'm1',
        kind: 'vocab',
        at: '2026-11-01T02:00:00.000Z',
        count: 2,
        label: 'abandon',
        question: { prompt: 'abandon' },
        text: '上下文',
      },
    ],
    readDone: [{ articleId: 'saved:1', day: '2026-11-01', title: '测试文章', at: '2026-11-01T02:30:00.000Z' }],
    writingHistory: [
      {
        at: '2026-11-01T03:00:00.000Z',
        articleId: 'saved:1',
        model: 'gpt',
        text: 'A long road.',
        feedback: { summary: 'ok' },
        source: 'goldenSentence',
      },
      // 白名单外的来源要读回 undefined，不能原样带出去
      { at: '2026-11-01T04:00:00.000Z', articleId: '', model: 'gpt', text: 'bad', feedback: {}, source: 'bogus' },
    ],
    backTranslations: [],
    retells: [],
    activity: [],
    studyDays: [],
    sessions: [],
    studiedDays: [],
    skimmed: [],
    kindStats: {},
    answerEvents: [],
    goldenDrills: [],
    writingErrorProgress: [],
    productionProgress: [],
  }
}

describe('schema 迁移', () => {
  it('新库一次迁到最新版本，且第二次调用不再动版本号', () => {
    const db = freshDb()
    expect(ensureSchema(db)).toBe(SCHEMA_VERSION)
    expect(userVersion(db)).toBe(SCHEMA_VERSION)

    const tables = tableNames(db)
    for (const name of [
      'vocab',
      'articles',
      'words',
      'practice_records',
      'writing_records',
      'reading_progress',
      'learning_snapshots',
      'production_progress',
    ]) {
      expect(tables.has(name), `缺表 ${name}`).toBe(true)
    }

    // 幂等：再跑一次不报错、版本不变
    expect(ensureSchema(db)).toBe(SCHEMA_VERSION)
    db.close()
  })

  it('v1 老库迁移：回填 articles 查询列，并建出文章派生表', () => {
    const db = freshDb()
    db.exec(SCHEMA_V1)
    db.exec('PRAGMA user_version = 1')
    const payload = {
      id: 'a1',
      title: '老文章',
      updatedAt: '2026-10-01T00:00:00.000Z',
      paragraphs: [{ id: 'p1', sentenceIds: ['s1', 's2'] }],
      sentences: [
        { id: 's1', paraId: 'p1', text: 'Hello there.', vocab: ['hello', 'there'] },
        { id: 's2', paraId: 'p1', text: 'Hi.', vocab: ['hi', 'there'] },
      ],
    }
    db.prepare('INSERT INTO articles (id, payload, title, updated_at) VALUES (?, ?, ?, ?)').run(
      'a1',
      JSON.stringify(payload),
      '老文章',
      payload.updatedAt,
    )

    expect(ensureSchema(db)).toBe(SCHEMA_VERSION)

    const row = db
      .prepare('SELECT title, sentence_count, word_count, created_at FROM articles WHERE id = ?')
      .get('a1') as Record<string, unknown>
    expect(row.title).toBe('老文章')
    expect(Number(row.sentence_count)).toBe(2)
    expect(Number(row.word_count)).toBe(3) // hello / there / hi 去重
    // payload 里没有 createdAt：用 updatedAt 兜底，不能留空
    expect(String(row.created_at)).toBe(payload.updatedAt)

    const sentences = db.prepare('SELECT COUNT(*) AS n FROM article_sentences WHERE article_id = ?').get('a1')
    expect(Number(sentences?.n)).toBe(2)
    db.close()
  })

  it('库版本高于程序支持版本时直接报错，不硬迁移', () => {
    const db = freshDb()
    db.exec('PRAGMA user_version = 999')
    expect(() => ensureSchema(db)).toThrow(/高于当前程序支持/)
    db.close()
  })
})

describe('学习记录读写', () => {
  it('整份写入后能原样读回，写作来源按白名单过滤', () => {
    const db = freshDb()
    ensureSchema(db)
    writeLearning(db, learningFixture())

    const out = loadLearning(db)
    expect(out.practice).toHaveLength(1)
    expect(out.practice[0]?.kind).toBe('vocab')
    expect(out.practice[0]?.total).toBe(20)
    expect(out.practice[0]?.correct).toBe(18)
    expect(out.mistakes[0]?.id).toBe('m1')
    expect(out.mistakes[0]?.question).toEqual({ prompt: 'abandon' })
    expect(out.readDone[0]?.articleId).toBe('saved:1')

    // writingHistory 按 at 倒序：白名单外的那条在前
    expect(out.writingHistory).toHaveLength(2)
    expect(out.writingHistory[0]?.source).toBeUndefined()
    expect(out.writingHistory[1]?.source).toBe('goldenSentence')
    db.close()
  })

  it('分节写只替换指定 section，别的 section 不动', () => {
    const db = freshDb()
    ensureSchema(db)
    writeLearning(db, learningFixture())

    writeLearning(
      db,
      { practice: [{ at: '2026-11-02T02:00:00.000Z', kind: 'quiz', total: 5, correct: 5 }] },
      ['practice'],
    )

    const out = loadLearning(db)
    expect(out.practice).toHaveLength(1)
    expect(out.practice[0]?.kind).toBe('quiz')
    // 没点名的 section 原样保留
    expect(out.mistakes[0]?.id).toBe('m1')
    expect(out.readDone).toHaveLength(1)
    db.close()
  })

  it('形状不对的学习记录直接抛错，不静默当空库', () => {
    const db = freshDb()
    ensureSchema(db)
    expect(() => writeLearning(db, { practice: 'not-an-array' })).toThrow(/必须是数组/)
    expect(() => writeLearning(db, [])).toThrow(/需要对象/)
    db.close()
  })
})

describe('openStore 文件库', () => {
  function tempDbPath(): string {
    const dir = mkdtempSync(join(tmpdir(), 'xueba-test-'))
    tmpDirs.push(dir)
    return join(dir, 'xueba.db')
  }

  it('词库保存 → 读回 → 乐观锁冲突', async () => {
    const store = openStore(tempDbPath())
    expect(store).not.toBeNull()
    if (!store) return

    const lib = { items: [{ id: 'w1', word: 'abandon', lemma: 'abandon', kind: 'word' }] }
    const first = await store.saveVocab(lib)
    expect(first.count).toBe(1)

    // 读回的是同一份 JSON
    expect(store.loadVocab()).toEqual(lib)
    expect(store.vocabMeta()?.count).toBe(1)
    const words = store.db.prepare('SELECT word FROM words').all()
    expect(words.map((r) => String(r.word))).toEqual(['abandon'])

    // 拿旧版本号写 → 冲突，且库里仍是第一版
    await expect(
      store.saveVocab(
        { items: [...lib.items, { id: 'w2', word: 'bold', lemma: 'bold', kind: 'word' }] },
        { baseUpdatedAt: '1999-01-01T00:00:00.000Z' },
      ),
    ).rejects.toBeInstanceOf(VocabConflictError)
    expect(store.vocabMeta()?.count).toBe(1)

    // 拿正确版本号写 → 成功
    const second = await store.saveVocab(
      { items: [...lib.items, { id: 'w2', word: 'bold', lemma: 'bold', kind: 'word' }] },
      { baseUpdatedAt: first.updatedAt },
    )
    expect(second.count).toBe(2)
    store.close()
  })

  it('文章保存/读取/删除，关库重开后数据还在', () => {
    const dbPath = tempDbPath()
    const article = {
      id: 'saved:1',
      title: '测试文章',
      text: 'Hello there.',
      updatedAt: '2026-11-01T00:00:00.000Z',
      paragraphs: [{ id: 'p1', sentenceIds: ['s1'] }],
      sentences: [{ id: 's1', paraId: 'p1', text: 'Hello there.', vocab: ['hello'] }],
    }

    const first = openStore(dbPath)
    expect(first).not.toBeNull()
    if (!first) return
    first.saveArticle(article)
    // createdAt 落库后要能读回来（老文章没带就用 updatedAt 兜底）
    expect(first.getArticle('saved:1')).toMatchObject({ id: 'saved:1', createdAt: article.updatedAt })
    expect(first.listArticles()).toHaveLength(1)
    first.close()

    // 重开：同一个文件，数据仍在（顺带覆盖 WAL checkpoint 后的读路径）
    const second = openStore(dbPath)
    expect(second).not.toBeNull()
    if (!second) return
    expect(second.getArticle('saved:1')).toMatchObject({ id: 'saved:1', title: '测试文章' })

    second.removeArticle('saved:1')
    expect(second.getArticle('saved:1')).toBeNull()
    const left = second.db.prepare('SELECT COUNT(*) AS n FROM article_sentences').get()
    expect(Number(left?.n)).toBe(0) // 派生表跟着删干净
    second.close()
  })
})
