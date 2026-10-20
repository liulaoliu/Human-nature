import { afterEach, describe, expect, it, vi } from 'vitest'
import { existsSync, mkdtempSync, readdirSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { closeAllStores, openStore } from './sqliteStore.js'

const require = createRequire(import.meta.url)
const { DatabaseSync } = require('node:sqlite')

const lib = (n) => ({
  items: Array.from({ length: n }, (_, i) => ({ id: `w${i}`, word: `w${i}`, lemma: `w${i}` })),
})

function tempDb() {
  return join(mkdtempSync(join(tmpdir(), 'xueba-sqlite-')), 'xueba.db')
}

afterEach(() => {
  closeAllStores()
  vi.useRealTimers()
})

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
    expect(Number(second.db.prepare('PRAGMA user_version').get().user_version)).toBe(7)
    const daily = readdirSync(join(dirname(path), 'backups')).filter((name) =>
      /^xueba-daily-.*\.db$/.test(name),
    )
    expect(daily).toHaveLength(1)
    const dailyPath = join(dirname(path), 'backups', daily[0])
    const check = new DatabaseSync(dailyPath, { readOnly: true })
    expect(Object.values(check.prepare('PRAGMA quick_check').get())[0]).toBe('ok')
    check.close()

    // 同一天再打开不重复做整库备份；但已有的当天备份坏了要重新做。
    second.close()
    writeFileSync(dailyPath, 'not a sqlite file')
    const third = openStore(path)
    expect(third.loadVocab().items).toHaveLength(2)
    const repaired = readdirSync(join(dirname(path), 'backups')).filter((name) =>
      /^xueba-daily-.*\.db$/.test(name),
    )
    expect(repaired).toHaveLength(1)
    expect(statSync(join(dirname(path), 'backups', repaired[0])).size).toBeGreaterThan(0)
    const recheck = new DatabaseSync(join(dirname(path), 'backups', repaired[0]), { readOnly: true })
    expect(Object.values(recheck.prepare('PRAGMA quick_check').get())[0]).toBe('ok')
    recheck.close()
  })

  it('长开进程跨天后会自动补当天备份（不用重启）', async () => {
    vi.useFakeTimers()
    const path = tempDb()
    const first = openStore(path)
    first.saveVocab(lib(1))
    first.close()
    const store = openStore(path)
    const dir = join(dirname(path), 'backups')
    const daily = readdirSync(dir).find((name) => /^xueba-daily-.*\.db$/.test(name))
    expect(daily).toBeTruthy()
    unlinkSync(join(dir, daily))

    await vi.advanceTimersByTimeAsync(30 * 60 * 1000)
    const recreated = readdirSync(dir).find((name) => /^xueba-daily-.*\.db$/.test(name))
    expect(recreated).toBeTruthy()
    expect(existsSync(join(dir, recreated))).toBe(true)
    store.close()
    vi.useRealTimers()
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

  it('增量重建：未变化词条不动，变化/删除只动自己', () => {
    const store = openStore(tempDb())
    const items = [
      { id: 'w1', word: 'run', lemma: 'run', usage: ['run out'] },
      { id: 'w2', word: 'walk', lemma: 'walk', usage: ['walk away'] },
    ]
    store.saveVocab({ schemaVersion: 1, items })
    const rowid1 = store.db.prepare('SELECT rowid FROM words WHERE id = ?').get('w1').rowid

    store.saveVocab({
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

    store.saveVocab({
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

  it('覆盖/删除前留上一版，恢复后还能反悔', () => {
    const store = openStore(tempDb())
    store.saveArticle(article('a', '2026-01-01T00:00:00.000Z', 'v1'))
    expect(store.loadArticlePrev('a')).toBeNull()

    store.saveArticle(article('a', '2026-02-01T00:00:00.000Z', 'v2'))
    expect(store.loadArticlePrev('a').value.title).toBe('v1')
    expect(store.restoreArticlePrev('a').title).toBe('v1')
    expect(store.getArticle('a').title).toBe('v1')
    // 恢复前那一版（v2）进了 prev，恢复错了还能切回去。
    expect(store.loadArticlePrev('a').value.title).toBe('v2')

    store.removeArticle('a')
    expect(store.getArticle('a')).toBeNull()
    expect(store.loadArticlePrev('a').value.title).toBe('v1')
    expect(store.restoreArticlePrev('a').title).toBe('v1')
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

describe('sqliteStore：学习记录', () => {
  const learning = {
    practice: [
      { at: '2026-01-01T00:00:00.000Z', kind: 'quiz', total: 10, correct: 8, seconds: 60, articleId: 'a1' },
      { at: '2026-01-02T00:00:00.000Z', kind: 'dictation', total: 5, correct: 4 },
    ],
    mistakes: [
      {
        id: 'vocab:w1',
        kind: 'vocab',
        at: '2026-01-01T00:00:00.000Z',
        count: 2,
        label: 'run',
        itemId: 'w1',
        question: { id: 'q1', stem: 'run' },
        articleId: 'a1',
        text: 'run',
      },
    ],
    readDone: [{ day: '2026-01-01', articleId: 'a1', title: 'A', at: '2026-01-01T00:00:00.000Z' }],
    writingHistory: [
      {
        at: '2026-01-03T00:00:00.000Z',
        articleId: 'a1',
        articleTitle: 'A',
        model: 'I run.',
        text: 'I run every day.',
        feedback: { total: 8, max: 10, scores: [], issues: [] },
        task: { task: 'write', model: 'I run.', mustUse: [], rubric: [] },
      },
    ],
    retells: [{ at: '2026-01-04T00:00:00.000Z', articleId: 'a1', text: '复述', words: 12 }],
    activity: [
      { day: '2026-01-01', counts: { read: 2, vocab: 5 } },
      { day: '2026-01-02', counts: { listen: 3 } },
    ],
    studyDays: [{ day: '2026-01-01', seconds: 120, cards: 10 }],
    sessions: [{ at: '2026-01-01T00:00:00.000Z', seconds: 30, picked: 4 }],
    studiedDays: [{ day: '2026-01-01', ids: ['w1', 'w2'] }],
    skimmed: ['a1'],
    kindStats: { a1: { quiz: { total: 10, correct: 8 } } },
    answerEvents: [
      {
        at: '2026-01-05T10:00:00.000Z',
        day: '2026-01-05',
        articleId: 'a1',
        source: 'quiz',
        kind: 'cloze',
        cat: 'vocab',
        correct: true,
        questionId: 'q1',
      },
      {
        at: '2026-01-05T10:01:00.000Z',
        day: '2026-01-05',
        articleId: 'a1',
        source: 'quiz',
        kind: 'cloze',
        cat: 'vocab',
        correct: false,
      },
    ],
  }

  it('保存 / 读取 / 覆盖式替换，SQL 表能直接查', () => {
    const store = openStore(tempDb())
    expect(store.loadLearning().practice).toEqual([])
    store.saveLearning(learning)

    const got = store.loadLearning()
    expect(got.practice).toHaveLength(2)
    expect(got.practice[0]).toMatchObject({ kind: 'quiz', total: 10, correct: 8, articleId: 'a1' })
    expect(got.mistakes[0]).toMatchObject({ id: 'vocab:w1', count: 2, itemId: 'w1' })
    expect(got.mistakes[0].question).toEqual({ id: 'q1', stem: 'run' })
    expect(got.activity).toEqual([
      { day: '2026-01-01', counts: { read: 2, vocab: 5 } },
      { day: '2026-01-02', counts: { listen: 3 } },
    ])
    expect(got.studiedDays).toEqual([{ day: '2026-01-01', ids: ['w1', 'w2'] }])
    expect(got.kindStats).toEqual({ a1: { quiz: { total: 10, correct: 8 } } })
    expect(got.answerEvents).toHaveLength(2)
    expect(got.answerEvents[1]).toMatchObject({ day: '2026-01-05', kind: 'cloze', correct: false })

    expect(store.db.prepare('SELECT COUNT(*) AS n FROM practice_records').get().n).toBe(2)
    expect(store.db.prepare('SELECT COUNT(*) AS n FROM answer_events').get().n).toBe(2)
    expect(store.db.prepare('SELECT COUNT(*) AS n FROM study_word_days').get().n).toBe(2)
    expect(store.db.prepare('SELECT COUNT(*) AS n FROM reading_progress').get().n).toBe(1)

    store.saveLearning({ ...learning, practice: [] })
    expect(store.loadLearning().practice).toEqual([])
    expect(store.loadLearning().mistakes).toHaveLength(1)
  })

  it('partial 只替换变化的 section，不碰写作/背词等其它表', () => {
    const store = openStore(tempDb())
    store.saveLearning(learning)

    store.saveLearningPartial({
      practice: [{ at: '2026-02-01T00:00:00.000Z', kind: 'quiz', total: 1, correct: 1 }],
      activity: [{ day: '2026-02-01', counts: { vocab: 1 } }],
    })

    const got = store.loadLearning()
    expect(got.practice).toHaveLength(1)
    expect(got.practice[0].at).toBe('2026-02-01T00:00:00.000Z')
    expect(got.activity).toEqual([{ day: '2026-02-01', counts: { vocab: 1 } }])
    // 没提交的 section 原样保留
    expect(got.mistakes).toHaveLength(1)
    expect(got.writingHistory).toHaveLength(1)
    expect(got.studiedDays[0].ids).toEqual(['w1', 'w2'])
    expect(store.db.prepare('SELECT COUNT(*) AS n FROM writing_records').get().n).toBe(1)
  })

  it('partial 拒绝未知 section，避免拼错字段静默丢数据', () => {
    const store = openStore(tempDb())
    expect(() => store.saveLearningPartial({ practise: [] })).toThrow('未知学习记录 section')
  })

  it('答题事件可重建活动与题型统计（baseline + events）', () => {
    const store = openStore(tempDb())
    // 模拟 v7 迁移时留下的历史聚合基线
    store.db
      .prepare('INSERT OR REPLACE INTO learning_derived_baseline (id, payload, at) VALUES (1, ?, ?)')
      .run(
        JSON.stringify({
          activity: [{ day: '2026-01-01', counts: { vocab: 2 } }],
          kindStats: { a1: { cloze: { total: 2, correct: 2 } } },
        }),
        '2026-01-06T00:00:00.000Z',
      )
    store.saveLearning({
      ...learning,
      activity: [],
      kindStats: {},
      answerEvents: [
        { at: '2026-01-05T10:00:00.000Z', day: '2026-01-05', articleId: 'a1', source: 'quiz', kind: 'cloze', cat: 'vocab', correct: true },
        { at: '2026-01-05T10:01:00.000Z', day: '2026-01-05', articleId: 'a1', source: 'quiz', kind: 'cloze', cat: 'vocab', correct: false },
        { at: '2026-01-05T10:02:00.000Z', day: '2026-01-05', articleId: 'a1', source: 'dictation', kind: 'dictation', cat: 'listen', correct: true },
      ],
    })

    store.rebuildLearningDerived()

    const got = store.loadLearning()
    expect(got.activity).toEqual([
      { day: '2026-01-01', counts: { vocab: 2 } },
      { day: '2026-01-05', counts: { vocab: 2, listen: 1 } },
    ])
    expect(got.kindStats).toEqual({ a1: { cloze: { total: 4, correct: 3 } } })
    // 其它学习记录不受影响
    expect(got.practice).toHaveLength(2)
  })

  it('恢复旧快照不会删掉 append-only 的答题事件', () => {
    const store = openStore(tempDb())
    store.saveLearning(learning)
    const current = store.loadLearning()
    // 模拟 v7 之前的旧快照：没有 answerEvents 字段
    const { answerEvents: _drop, ...old } = current
    const info = store.db
      .prepare(
        'INSERT INTO learning_snapshots (at, reason, record_count, payload) VALUES (?, ?, ?, ?)',
      )
      .run('2026-01-06T00:00:00.000Z', 'legacy', 1, JSON.stringify(old))
    expect(store.loadLearning().answerEvents).toHaveLength(2)

    store.saveLearning({ ...learning, practice: [] })
    const restored = store.restoreLearningSnapshot(Number(info.lastInsertRowid))
    expect(restored.value.practice).toHaveLength(2)
    expect(restored.value.answerEvents).toHaveLength(2)
  })

  it('覆盖前自动留快照，误清空后可以恢复', () => {
    const store = openStore(tempDb())
    store.saveLearning(learning)
    // 第一次写入空库不留快照；这次覆盖前会把完整记录存下来。
    store.saveLearning({ ...learning, practice: [] })

    const snaps = store.listLearningSnapshots()
    expect(snaps.length).toBeGreaterThan(0)
    const before = store.loadLearningSnapshot(snaps[0].id)
    expect(before.value.practice).toHaveLength(2)
    expect(before.recordCount).toBeGreaterThan(0)
    expect(store.loadLearningSnapshot(999999)).toBeNull()

    const restored = store.restoreLearningSnapshot(snaps[0].id)
    expect(restored.value.practice).toHaveLength(2)
    expect(store.loadLearning().practice).toHaveLength(2)
    // 恢复动作本身也先留了“恢复前”的快照，恢复错了还能回去。
    expect(store.listLearningSnapshots().length).toBeGreaterThan(snaps.length)
  })

  it('快照只留最近 30 份 + 记录最多的一份', () => {
    const store = openStore(tempDb())
    store.saveLearning(learning)
    for (let i = 0; i < 35; i++) {
      store.saveLearning({ ...learning, practice: [{ at: `2026-03-${String((i % 28) + 1).padStart(2, '0')}T00:00:00.000Z`, kind: 'quiz', total: i, correct: i }] })
    }
    expect(store.listLearningSnapshots().length).toBeLessThanOrEqual(31)
    expect(store.listLearningSnapshots().some((s) => s.recordCount >= 8)).toBe(true)
  })

  it('if-empty 只在服务端没有任何学习记录时迁移', () => {
    const store = openStore(tempDb())
    const first = store.migrateLearning(learning)
    expect(first.migrated).toBe(true)
    expect(first.value.practice).toHaveLength(2)

    const second = store.migrateLearning({ ...learning, practice: [] })
    expect(second.migrated).toBe(false)
    expect(second.value.practice).toHaveLength(2)
  })

  it('导出包含学习记录', () => {
    const store = openStore(tempDb())
    store.saveLearning(learning)
    expect(store.exportAll().learning.practice).toHaveLength(2)
  })
})

describe('sqliteStore：v1 → v7 迁移', () => {
  it('旧库的 JSON 会自动回填派生表，并把标题形式的文章 id 换成真 id', () => {
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
          items: [
            {
              id: 'w1',
              word: 'run',
              lemma: 'run',
              usage: ['run out'],
              source: { articleId: 'Old', sentenceId: 's1', sentenceText: 'I run.' },
              examples: [{ text: 'I run.', articleId: 'Old' }],
              contexts: [{ articleId: 'Old', sentenceId: 's1', sentenceText: 'I run.' }],
            },
          ],
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
    expect(Number(store.db.prepare('PRAGMA user_version').get().user_version)).toBe(7)
    // 迁移前整库备份，出事能回到 v1。
    const backups = readdirSync(join(dirname(path), 'backups'))
    const migrationBackups = backups.filter((name) => /^xueba-v1-.*\.db$/.test(name))
    expect(migrationBackups).toHaveLength(1)
    expect(backups.some((name) => /^xueba-daily-.*\.db$/.test(name))).toBe(true)
    const saved = store.loadVocab().items[0]
    expect(saved.source.articleId).toBe('a1')
    expect(saved.examples[0].articleId).toBe('a1')
    expect(saved.contexts[0].articleId).toBe('a1')
    expect(store.db.prepare('SELECT source_article_id FROM words WHERE id = ?').get('w1').source_article_id).toBe('a1')
    expect(store.db.prepare('SELECT article_id FROM word_contexts WHERE word_id = ?').get('w1').article_id).toBe('a1')
    expect(store.db.prepare('SELECT article_id FROM word_examples WHERE word_id = ?').get('w1').article_id).toBe('a1')
    expect(store.db.prepare('SELECT COUNT(*) AS n FROM words').get().n).toBe(1)
    expect(store.db.prepare('SELECT COUNT(*) AS n FROM word_usage').get().n).toBe(1)
    expect(store.db.prepare('SELECT COUNT(*) AS n FROM article_sentences').get().n).toBe(1)
    expect(store.db.prepare('SELECT COUNT(*) AS n FROM lang_points').get().n).toBe(1)
    expect(store.db.prepare('SELECT translation FROM article_sentences WHERE article_id = ?').get('a1').translation).toBe('我跑。')
  })
})
