import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { closeAllStores, openStore } from './sqliteStore.js'

const require = createRequire(import.meta.url)
const { DatabaseSync } = require('node:sqlite')

const lib = (n) => ({
  items: Array.from({ length: n }, (_, i) => ({ id: `w${i}`, word: `w${i}`, lemma: `w${i}` })),
})

function tempDb() {
  return join(mkdtempSync(join(tmpdir(), 'xueba-sqlite-')), 'xueba.db')
}

afterEach(() => closeAllStores())

describe('sqliteStore：词库', () => {
  it('保存 / 读取 / 上一版只留更大的那一份', () => {
    const store = openStore(tempDb())
    expect(store).not.toBeNull()

    expect(store.loadVocab()).toBeNull()
    store.saveVocab(lib(3))
    expect(store.loadVocab().items).toHaveLength(3)
    expect(store.loadPrev()).toBeNull()

    store.saveVocab(lib(5))
    expect(store.loadPrev().items).toHaveLength(3)

    // 事故/误清：空库写进去，备份仍是事故前最大的 5
    store.saveVocab(lib(0))
    expect(store.loadVocab().items).toHaveLength(0)
    expect(store.loadPrev().items).toHaveLength(5)

    store.saveVocab(lib(4))
    expect(store.loadPrev().items).toHaveLength(5)
  })

  it('快照保留最近 8 版 + 历史最大的一版', () => {
    const store = openStore(tempDb())
    store.saveVocab(lib(10))
    for (let n = 0; n <= 7; n++) store.saveVocab(lib(n))

    const snaps = store.listSnapshots()
    expect(snaps).toHaveLength(9)
    expect(snaps.some((s) => s.count === 10)).toBe(true)
    expect(store.loadSnapshot(snaps[0].at)).not.toBeNull()
  })

  it('首次迁移只在服务端空库时写入', () => {
    const store = openStore(tempDb())
    const first = store.migrateVocab(lib(3))
    expect(first.migrated).toBe(true)
    expect(first.value.items).toHaveLength(3)

    const second = store.migrateVocab(lib(9))
    expect(second.migrated).toBe(false)
    expect(second.value.items).toHaveLength(3)
    expect(store.loadVocab().items).toHaveLength(3)
  })

  it('clear 只清当前词库，上一版/快照还能恢复', () => {
    const store = openStore(tempDb())
    store.saveVocab(lib(6))
    store.clearVocab()
    expect(store.loadVocab()).toBeNull()
    expect(store.loadPrev().items).toHaveLength(6)
    expect(store.listSnapshots().length).toBeGreaterThan(0)
  })

  it('重新打开同一个文件，数据和 schema 版本都在', () => {
    const path = tempDb()
    const first = openStore(path)
    first.saveVocab(lib(2))
    first.close()

    const second = openStore(path)
    expect(second.loadVocab().items).toHaveLength(2)
    expect(Number(second.db.prepare('PRAGMA user_version').get().user_version)).toBe(2)
  })

  it('派生表：词条 / 用法 / 例句 / 语境 / 易混项都能 SQL 查', () => {
    const store = openStore(tempDb())
    store.saveVocab({
      schemaVersion: 1,
      items: [
        {
          id: 'w1',
          word: 'run',
          lemma: 'run',
          kind: 'word',
          langPointId: 'lp1',
          phonetic: '/rʌn/',
          partOfSpeech: 'v.',
          meaning: '跑',
          definition: 'move quickly on foot',
          usage: ['run out 用完'],
          phrases: ['run a business'],
          idioms: ['run in the family'],
          grammarMarks: ['不及物'],
          examples: [
            { text: 'I run every day.', translation: '我每天跑步。', origin: 'ai', articleId: 'a1', sentenceId: 's1' },
          ],
          contexts: [
            { articleId: 'a1', fileName: null, sentenceId: 's1', sentenceText: 'I run every day.', meaning: '跑步', at: '2026-01-01T00:00:00.000Z' },
          ],
          source: { articleId: 'a1', fileName: null, sentenceId: 's1', sentenceText: 'I run every day.' },
          status: 'queried',
          note: '笔记',
          tags: ['动词'],
          confusables: [{ word: 'ran', meaning: 'run 的过去式' }],
          reviewState: { ease: 2.5, due: null, interval: 0, repetitions: 0, lapses: 1 },
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-02T00:00:00.000Z',
        },
      ],
    })

    const word = store.db.prepare('SELECT * FROM words WHERE id = ?').get('w1')
    expect(word).toMatchObject({ word: 'run', lemma: 'run', kind: 'word', meaning: '跑', review_lapses: 1 })
    expect(store.db.prepare('SELECT text FROM word_usage WHERE word_id = ?').get('w1').text).toBe('run out 用完')
    expect(store.db.prepare('SELECT text FROM word_phrases WHERE word_id = ?').get('w1').text).toBe('run a business')
    expect(store.db.prepare('SELECT text FROM word_idioms WHERE word_id = ?').get('w1').text).toBe('run in the family')
    expect(store.db.prepare('SELECT text FROM word_grammar_marks WHERE word_id = ?').get('w1').text).toBe('不及物')
    expect(store.db.prepare('SELECT text FROM word_examples WHERE word_id = ?').get('w1').text).toBe('I run every day.')
    expect(store.db.prepare('SELECT meaning FROM word_contexts WHERE word_id = ?').get('w1').meaning).toBe('跑步')
    expect(store.db.prepare('SELECT word FROM word_confusables WHERE word_id = ?').get('w1').word).toBe('ran')
  })
})

describe('sqliteStore：文章', () => {
  const article = (id, updatedAt, title = id) => ({
    id,
    title,
    sourceKey: null,
    text: `text-${id}`,
    paragraphs: [],
    sentences: [],
    updatedAt,
  })

  it('保存 / 列表按 updatedAt 倒序 / 单篇读取 / 删除', () => {
    const store = openStore(tempDb())
    store.saveArticle(article('a', '2026-01-01T00:00:00.000Z'))
    store.saveArticle(article('b', '2026-02-01T00:00:00.000Z'))

    expect(store.listArticles().map((a) => a.id)).toEqual(['b', 'a'])
    expect(store.getArticle('a').title).toBe('a')
    store.removeArticle('a')
    expect(store.getArticle('a')).toBeNull()
  })

  it('导出包含词库、快照和文章', () => {
    const store = openStore(tempDb())
    store.saveVocab(lib(2))
    store.saveArticle(article('a', '2026-01-01T00:00:00.000Z'))
    const dump = store.exportAll()
    expect(dump.vocab.items).toHaveLength(2)
    expect(dump.vocabSnapshots.length).toBeGreaterThan(0)
    expect(dump.articles[0].id).toBe('a')
  })

  it('派生表：句子 / 翻译 / 段落 / 手动语言点都能 SQL 查，删文章一起清', () => {
    const store = openStore(tempDb())
    store.saveArticle({
      id: 'a1',
      title: 'Test',
      book: 'Book',
      sourceKey: null,
      text: 'I run every day.',
      paragraphs: [{ id: 'p1', sentenceIds: ['s1'] }],
      sentences: [
        {
          id: 's1',
          paraId: 'p1',
          text: 'I run every day.',
          audio: { start: 1.25, end: 2.5 },
          translation: '我每天跑步。',
          grammarNote: '一般现在时',
          collocations: ['every day'],
          vocab: ['run'],
          tags: ['long_sentence'],
          language: { structure: 'SVO', phrases: ['run out'] },
          languages: [
            {
              structure: '主谓',
              grammar: '一般现在时',
              idioms: ['run in the family'],
              phrases: ['run out'],
              usage: ['run 的用法'],
              source: 'manual',
              at: '2026-01-01T00:00:00.000Z',
            },
          ],
          reviewState: { ease: 2.5, due: null, interval: 0, repetitions: 0, lapses: 0 },
        },
      ],
      updatedAt: '2026-01-01T00:00:00.000Z',
      createdAt: '2026-01-01T00:00:00.000Z',
    })

    const sentence = store.db.prepare('SELECT * FROM article_sentences WHERE article_id = ?').get('a1')
    expect(sentence).toMatchObject({
      id: 's1',
      translation: '我每天跑步。',
      audio_start: 1.25,
      audio_end: 2.5,
    })
    expect(store.db.prepare('SELECT COUNT(*) AS n FROM article_paragraph_sentences WHERE article_id = ?').get('a1').n).toBe(1)
    expect(store.db.prepare('SELECT COUNT(*) AS n FROM article_collocations WHERE article_id = ?').get('a1').n).toBe(1)
    expect(store.db.prepare('SELECT COUNT(*) AS n FROM article_sentence_vocab WHERE article_id = ?').get('a1').n).toBe(1)
    expect(store.db.prepare('SELECT COUNT(*) AS n FROM lang_points WHERE article_id = ?').get('a1').n).toBe(1)
    expect(
      store.db.prepare('SELECT COUNT(*) AS n FROM lang_point_terms WHERE lang_point_id = ?').get('a1:s1:lang:0').n,
    ).toBe(3)
    expect(store.db.prepare('SELECT book FROM articles WHERE id = ?').get('a1').book).toBe('Book')

    store.removeArticle('a1')
    expect(store.db.prepare('SELECT COUNT(*) AS n FROM article_sentences WHERE article_id = ?').get('a1').n).toBe(0)
    expect(store.db.prepare('SELECT COUNT(*) AS n FROM lang_points WHERE article_id = ?').get('a1').n).toBe(0)
  })
})

describe('sqliteStore：v1 → v2 迁移', () => {
  it('旧库的 JSON 会自动回填派生表，原数据不动', () => {
    const path = tempDb()
    const old = new DatabaseSync(path)
    old.exec(`
      CREATE TABLE vocab (id INTEGER PRIMARY KEY CHECK (id = 1), payload TEXT NOT NULL, item_count INTEGER NOT NULL, updated_at TEXT NOT NULL);
      CREATE TABLE vocab_prev (id INTEGER PRIMARY KEY CHECK (id = 1), payload TEXT NOT NULL, item_count INTEGER NOT NULL, updated_at TEXT NOT NULL);
      CREATE TABLE vocab_snapshots (at TEXT PRIMARY KEY, payload TEXT NOT NULL, item_count INTEGER NOT NULL);
      CREATE TABLE articles (id TEXT PRIMARY KEY, payload TEXT NOT NULL, title TEXT NOT NULL DEFAULT '', updated_at TEXT NOT NULL);
      PRAGMA user_version = 1;
    `)
    old
      .prepare('INSERT INTO vocab (id, payload, item_count, updated_at) VALUES (1, ?, ?, ?)')
      .run(
        JSON.stringify({
          schemaVersion: 1,
          items: [{ id: 'w1', word: 'run', lemma: 'run', usage: ['run out'], examples: [{ text: 'I run.' }] }],
        }),
        1,
        '2026-01-01T00:00:00.000Z',
      )
    old
      .prepare('INSERT INTO articles (id, payload, title, updated_at) VALUES (?, ?, ?, ?)')
      .run(
        'a1',
        JSON.stringify({
          id: 'a1',
          title: 'Old',
          sourceKey: null,
          text: 'I run.',
          paragraphs: [{ id: 'p1', sentenceIds: ['s1'] }],
          sentences: [
            {
              id: 's1',
              paraId: 'p1',
              text: 'I run.',
              audio: null,
              translation: '我跑。',
              grammarNote: null,
              collocations: [],
              vocab: ['run'],
              tags: [],
              languages: [{ phrases: ['run out'], source: 'manual' }],
              reviewState: { ease: 2.5, due: null, interval: 0, repetitions: 0 },
            },
          ],
          updatedAt: '2026-01-01T00:00:00.000Z',
        }),
        'Old',
        '2026-01-01T00:00:00.000Z',
      )
    old.close()

    const store = openStore(path)
    expect(Number(store.db.prepare('PRAGMA user_version').get().user_version)).toBe(2)
    expect(store.loadVocab().items).toHaveLength(1)
    expect(store.db.prepare('SELECT COUNT(*) AS n FROM words').get().n).toBe(1)
    expect(store.db.prepare('SELECT COUNT(*) AS n FROM word_usage').get().n).toBe(1)
    expect(store.db.prepare('SELECT COUNT(*) AS n FROM article_sentences').get().n).toBe(1)
    expect(store.db.prepare('SELECT COUNT(*) AS n FROM lang_points').get().n).toBe(1)
    expect(store.db.prepare('SELECT translation FROM article_sentences WHERE article_id = ?').get('a1').translation).toBe('我跑。')
  })
})
