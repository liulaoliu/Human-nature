// 服务端持久层老测试（第一部分）：词库与文章。
import { afterEach, describe, expect, it, vi } from 'vitest'
import { existsSync, readdirSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { closeAllStores, SCHEMA_VERSION } from './sqliteStore.ts'
import { mustOpen, openDb, vocab, mustArticle, firstItem, lib, tempDb } from './legacyTestKit.ts'
import type { ArticleData } from './legacyTestKit.ts'

afterEach(() => {
  closeAllStores()
  vi.useRealTimers()
})

describe('sqliteStore：词库', () => {
  it('版本号对不上就拒绝写入（旧标签页不能抹掉别处的改动）', async () => {
    const store = mustOpen(tempDb())
    const v1 = await store.saveVocab(lib(3))
    expect(v1.updatedAt).toBeTruthy()

    // 带着自己读到的那一版写：放行，并换新的令牌
    const v2 = await store.saveVocab(lib(4), { baseUpdatedAt: v1.updatedAt })
    expect(v2.updatedAt).not.toBe(v1.updatedAt)
    expect(vocab(store).items).toHaveLength(4)

    // 旧标签页还拿着 v1：必须被挡，库里还是 4
    await expect(store.saveVocab(lib(2), { baseUpdatedAt: v1.updatedAt })).rejects.toThrow(/改过/)
    expect(vocab(store).items).toHaveLength(4)
    expect(store.vocabMeta()?.count).toBe(4)

    // 不带 base = 强制写（迁移脚本 / curl / 工具）
    await store.saveVocab(lib(5))
    expect(vocab(store).items).toHaveLength(5)

    // 乱传一个版本号，同样被挡
    await expect(store.saveVocab(lib(6), { baseUpdatedAt: '1999-01-01T00:00:00.000Z' })).rejects.toThrow(/改过/)
    expect(vocab(store).items).toHaveLength(5)
  })

  it('快照保留最近 5 版 + 历史最大的一版', async () => {
    const store = mustOpen(tempDb())
    await store.saveVocab(lib(10))
    for (let n = 0; n <= 7; n++) await store.saveVocab(lib(n))

    const snaps = store.listSnapshots()
    expect(snaps).toHaveLength(6)
    expect(snaps.some((s) => s.count === 10)).toBe(true)
    expect(store.loadSnapshot(firstItem(snaps).at)).not.toBeNull()
  })

  it('快照是 gzip 存的，读回来还能还原', async () => {
    const path = tempDb()
    const store = mustOpen(path)
    await store.saveVocab(lib(3))
    await store.saveVocab(lib(4))

    const raw = openDb(path, { readOnly: true })
    const snap = raw.prepare('SELECT payload FROM vocab_snapshots LIMIT 1').get()
    // 已删除的功能不再建表（老库里留着的旧表也不读）：词库上一版 / 文章上一版
    const dropped = raw
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('vocab_prev', 'article_prev')",
      )
      .all()
    // v12 重新建了学习记录快照表（节流 + gzip），这里确认它存在
    const kept = raw
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'learning_snapshots'")
      .all()
    raw.close()
    // 16MB 的整库 JSON 存两份就是 32MB；压完是 BLOB，不是 JSON 文本
    expect(typeof snap.payload).not.toBe('string')
    expect(dropped).toEqual([])
    expect(kept).toHaveLength(1)
    expect(firstItem(store.exportAll().vocabSnapshots).library.items.length).toBeGreaterThan(0)
  })

  it('首次迁移只在服务端空库时写入', async () => {
    const store = mustOpen(tempDb())
    const first = store.migrateVocab(lib(3))
    expect(first.migrated).toBe(true)
    expect(first.value.items).toHaveLength(3)

    const second = store.migrateVocab(lib(9))
    expect(second.migrated).toBe(false)
    expect(second.value.items).toHaveLength(3)
    expect(vocab(store).items).toHaveLength(3)
  })

  it('clear 只清当前词库，历史快照还在', async () => {
    const store = mustOpen(tempDb())
    await store.saveVocab(lib(6))
    store.clearVocab()
    expect(store.loadVocab()).toBeNull()
    expect(store.listSnapshots().length).toBeGreaterThan(0)
  })

  it('重新打开同一个文件，数据和 schema 版本都在', async () => {
    const path = tempDb()
    const first = mustOpen(path)
    await first.saveVocab(lib(2))
    first.close()

    const second = mustOpen(path)
    expect(vocab(second).items).toHaveLength(2)
    expect(Number(second.db.prepare('PRAGMA user_version').get().user_version)).toBe(SCHEMA_VERSION)
    const daily = readdirSync(join(dirname(path), 'backups')).filter((name) =>
      /^xueba-daily-.*\.db$/.test(name),
    )
    expect(daily).toHaveLength(1)
    const dailyPath = join(dirname(path), 'backups', firstItem(daily))
    const check = openDb(dailyPath, { readOnly: true })
    expect(Object.values(check.prepare('PRAGMA quick_check').get())[0]).toBe('ok')
    check.close()

    // 同一天再打开不重复做整库备份；但已有的当天备份坏了要重新做。
    second.close()
    writeFileSync(dailyPath, 'not a sqlite file')
    const third = mustOpen(path)
    expect(vocab(third).items).toHaveLength(2)
    const repaired = readdirSync(join(dirname(path), 'backups')).filter((name) =>
      /^xueba-daily-.*\.db$/.test(name),
    )
    expect(repaired).toHaveLength(1)
    expect(statSync(join(dirname(path), 'backups', firstItem(repaired))).size).toBeGreaterThan(0)
    const recheck = openDb(join(dirname(path), 'backups', firstItem(repaired)), { readOnly: true })
    expect(Object.values(recheck.prepare('PRAGMA quick_check').get())[0]).toBe('ok')
    recheck.close()
  })

  it('长开进程跨天后会自动补当天备份（不用重启）', async () => {
    vi.useFakeTimers()
    const path = tempDb()
    const first = mustOpen(path)
    await first.saveVocab(lib(1))
    first.close()
    const store = mustOpen(path)
    const dir = join(dirname(path), 'backups')
    const daily = readdirSync(dir).find((name) => /^xueba-daily-.*\.db$/.test(name))
    expect(daily).toBeTruthy()
    if (!daily) throw new Error('没有当天备份')
    unlinkSync(join(dir, daily))

    await vi.advanceTimersByTimeAsync(30 * 60 * 1000)
    const recreated = readdirSync(dir).find((name) => /^xueba-daily-.*\.db$/.test(name))
    expect(recreated).toBeTruthy()
    if (!recreated) throw new Error('当天备份没有补上')
    expect(existsSync(join(dir, recreated))).toBe(true)
    store.close()
    vi.useRealTimers()
  })

  it('派生表：词条 / 用法 / 例句 / 语境 / 易混项都能 SQL 查', async () => {
    const store = mustOpen(tempDb())
    await store.saveVocab({
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

  it('增量重建：未变化词条不动，变化/删除只动自己', async () => {
    const store = mustOpen(tempDb())
    const items = [
      { id: 'w1', word: 'run', lemma: 'run', usage: ['run out'] },
      { id: 'w2', word: 'walk', lemma: 'walk', usage: ['walk away'] },
    ]
    await store.saveVocab({ schemaVersion: 1, items })
    const rowid1 = store.db.prepare('SELECT rowid FROM words WHERE id = ?').get('w1').rowid

    await store.saveVocab({
      schemaVersion: 1,
      items: [
        { id: 'w1', word: 'run', lemma: 'run', usage: ['run out'] },
        { id: 'w2', word: 'walked', lemma: 'walk', usage: ['walked away'] },
        { id: 'w3', word: 'jump', lemma: 'jump' },
      ],
    })
    // 没变的 w1 保留原 rowid（全量重建会换掉）
    expect(store.db.prepare('SELECT rowid FROM words WHERE id = ?').get('w1').rowid).toBe(rowid1)
    expect(store.db.prepare('SELECT word FROM words WHERE id = ?').get('w2').word).toBe('walked')
    expect(store.db.prepare('SELECT text FROM word_usage WHERE word_id = ?').get('w2').text).toBe('walked away')
    expect(store.db.prepare('SELECT word FROM words WHERE id = ?').get('w3').word).toBe('jump')

    await store.saveVocab({
      schemaVersion: 1,
      items: [
        { id: 'w1', word: 'run', lemma: 'run', usage: ['run out'] },
        { id: 'w3', word: 'jump', lemma: 'jump' },
      ],
    })
    expect(store.db.prepare('SELECT COUNT(*) AS n FROM words').get().n).toBe(2)
    expect(store.db.prepare('SELECT COUNT(*) AS n FROM word_usage WHERE word_id = ?').get('w2').n).toBe(0)
  })
})

describe('sqliteStore：文章', () => {
  const article = (id: string, updatedAt: string, title: string = id): ArticleData => ({
    id,
    title,
    sourceKey: null,
    text: `text-${id}`,
    paragraphs: [],
    sentences: [],
    updatedAt,
  })

  it('保存 / 列表按 updatedAt 倒序 / 单篇读取 / 删除', async () => {
    const store = mustOpen(tempDb())
    store.saveArticle(article('a', '2026-01-01T00:00:00.000Z'))
    store.saveArticle(article('b', '2026-02-01T00:00:00.000Z'))

    expect(store.listArticles().map((a) => a.id)).toEqual(['b', 'a'])
    expect(mustArticle(store, 'a').title).toBe('a')
    store.removeArticle('a')
    expect(store.getArticle('a')).toBeNull()
  })

  it('覆盖保存时保留首次建立时间；客户端没带 createdAt 也不会重置', async () => {
    const store = mustOpen(tempDb())
    store.saveArticle(article('a', '2026-01-01T00:00:00.000Z'))
    expect(mustArticle(store, 'a').createdAt).toBe('2026-01-01T00:00:00.000Z')

    store.saveArticle(article('a', '2026-02-01T00:00:00.000Z'))
    expect(mustArticle(store, 'a').updatedAt).toBe('2026-02-01T00:00:00.000Z')
    expect(mustArticle(store, 'a').createdAt).toBe('2026-01-01T00:00:00.000Z')
    expect(firstItem(store.listArticles()).createdAt).toBe('2026-01-01T00:00:00.000Z')
    expect(store.db.prepare('SELECT created_at FROM articles WHERE id = ?').get('a').created_at).toBe(
      '2026-01-01T00:00:00.000Z',
    )
  })

  it('导出包含词库、快照和文章', async () => {
    const store = mustOpen(tempDb())
    await store.saveVocab(lib(2))
    store.saveArticle(article('a', '2026-01-01T00:00:00.000Z'))
    const dump = store.exportAll()
    expect(dump.vocab?.items).toHaveLength(2)
    expect(dump.vocabSnapshots.length).toBeGreaterThan(0)
    expect(firstItem(dump.articles).id).toBe('a')
  })

  it('派生表：句子 / 翻译 / 段落 / 手动语言点都能 SQL 查，删文章一起清', async () => {
    const store = mustOpen(tempDb())
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