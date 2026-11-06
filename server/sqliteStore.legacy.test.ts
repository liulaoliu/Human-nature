// 服务端持久层老测试（第二部分）：学习记录 / 派生重建 / v1→v7 迁移。
import { afterEach, describe, expect, it, vi } from 'vitest'
import { readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { closeAllStores, SCHEMA_VERSION } from './sqliteStore.ts'
import { mustOpen, openDb, vocab, at, firstItem, tempDb } from './legacyTestKit.ts'

afterEach(() => {
  closeAllStores()
  vi.useRealTimers()
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
    backTranslations: [
      {
        id: 'bt1',
        at: '2026-01-06T00:00:00.000Z',
        articleId: 'a1',
        articleTitle: 'A',
        sentenceId: 's1',
        sourceZh: '我每天跑步。',
        contextZh: '早上空气很好。',
        answer: 'I run every day.',
        reference: 'I run every day.',
        feedback: {
          scores: [{ dimension: '意思还原', score: 36, max: 40 }],
          total: 86,
          max: 100,
          issues: [],
          alternatives: ['I go running every day.'],
          summary: '不错。',
        },
        closeness: { exact: true, ratio: 1 },
        gradedBy: 'local',
      },
    ],
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
    goldenDrills: [
      {
        id: 'a1|s1|k',
        at: '2026-01-07T00:00:00.000Z',
        articleId: 'a1',
        articleTitle: 'A',
        sentenceId: 's1',
        drillKey: 'k',
        fillFirst: true,
        assembleFirst: true,
        recallFirst: true,
        fillTries: 1,
        assembleTries: 1,
        recallTries: 1,
        summarySeen: true,
        mastered: true,
        completedAt: '2026-01-07T00:00:00.000Z',
      },
    ],
    writingErrorProgress: [
      {
        id: 'errfix:word-spelling|spelling-bureaucracy',
        rule: 'word-spelling',
        key: 'spelling-bureaucracy',
        articleId: 'a1',
        sentenceId: 's1',
        original: 'bureacracy',
        suggestion: 'bureaucracy',
        reason: '拼写',
        status: 'active',
        streak: 2,
        reviews: 3,
        lastAt: '2026-01-08T00:00:00.000Z',
        lastCorrect: true,
        dueAt: '2026-01-15T00:00:00.000Z',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-08T00:00:00.000Z',
      },
    ],
  }

  it('保存 / 读取 / 覆盖式替换，SQL 表能直接查', async () => {
    const store = mustOpen(tempDb())
    expect(store.loadLearning().practice).toEqual([])
    store.saveLearning(learning)

    const got = store.loadLearning()
    expect(got.practice).toHaveLength(2)
    expect(firstItem(got.practice)).toMatchObject({ kind: 'quiz', total: 10, correct: 8, articleId: 'a1' })
    expect(firstItem(got.mistakes)).toMatchObject({ id: 'vocab:w1', count: 2, itemId: 'w1' })
    expect(firstItem(got.mistakes).question).toEqual({ id: 'q1', stem: 'run' })
    expect(got.activity).toEqual([
      { day: '2026-01-01', counts: { read: 2, vocab: 5 } },
      { day: '2026-01-02', counts: { listen: 3 } },
    ])
    expect(got.studiedDays).toEqual([{ day: '2026-01-01', ids: ['w1', 'w2'] }])
    expect(got.kindStats).toEqual({ a1: { quiz: { total: 10, correct: 8 } } })
    expect(got.answerEvents).toHaveLength(2)
    expect(at(got.answerEvents, 1)).toMatchObject({ day: '2026-01-05', kind: 'cloze', correct: false })
    expect(got.backTranslations).toHaveLength(1)
    expect(firstItem(got.backTranslations)).toMatchObject({
      id: 'bt1',
      sourceZh: '我每天跑步。',
      answer: 'I run every day.',
      gradedBy: 'local',
    })
    expect(firstItem(got.backTranslations).feedback).toMatchObject({ total: 86, max: 100 })
    expect(got.goldenDrills).toHaveLength(1)
    expect(firstItem(got.goldenDrills)).toMatchObject({ id: 'a1|s1|k', mastered: true, fillFirst: true, summarySeen: true })
    expect(got.writingErrorProgress).toHaveLength(1)
    expect(firstItem(got.writingErrorProgress)).toMatchObject({
      id: 'errfix:word-spelling|spelling-bureaucracy',
      status: 'active',
      streak: 2,
      reviews: 3,
      lastCorrect: true,
    })
    expect(store.db.prepare('SELECT COUNT(*) AS n FROM writing_error_progress').get().n).toBe(1)

    expect(store.db.prepare('SELECT COUNT(*) AS n FROM practice_records').get().n).toBe(2)
    expect(store.db.prepare('SELECT COUNT(*) AS n FROM answer_events').get().n).toBe(2)
    expect(store.db.prepare('SELECT COUNT(*) AS n FROM back_translation_records').get().n).toBe(1)
    expect(store.db.prepare('SELECT COUNT(*) AS n FROM study_word_days').get().n).toBe(2)
    expect(store.db.prepare('SELECT COUNT(*) AS n FROM reading_progress').get().n).toBe(1)

    store.saveLearning({ ...learning, practice: [] })
    expect(store.loadLearning().practice).toEqual([])
    expect(store.loadLearning().mistakes).toHaveLength(1)
  })

  it('partial 只替换变化的 section，不碰写作/背词等其它表', async () => {
    const store = mustOpen(tempDb())
    store.saveLearning(learning)

    store.saveLearningPartial({
      practice: [{ at: '2026-02-01T00:00:00.000Z', kind: 'quiz', total: 1, correct: 1 }],
      activity: [{ day: '2026-02-01', counts: { vocab: 1 } }],
    })

    const got = store.loadLearning()
    expect(got.practice).toHaveLength(1)
    expect(firstItem(got.practice).at).toBe('2026-02-01T00:00:00.000Z')
    expect(got.activity).toEqual([{ day: '2026-02-01', counts: { vocab: 1 } }])
    // 没提交的 section 原样保留
    expect(got.mistakes).toHaveLength(1)
    expect(got.writingHistory).toHaveLength(1)
    expect(firstItem(got.studiedDays).ids).toEqual(['w1', 'w2'])
    expect(store.db.prepare('SELECT COUNT(*) AS n FROM writing_records').get().n).toBe(1)
  })

  it('仿写记录保留来源（单句 / 整课 / 错因订正），坏值当普通仿写', async () => {
    const store = mustOpen(tempDb())
    const base = {
      articleId: 'a1',
      articleTitle: 'A',
      model: 'I run.',
      text: 'I run every day.',
      feedback: { total: 8, max: 10, scores: [], issues: [] },
      task: { task: 'write', model: 'I run.', mustUse: [], rubric: [] },
    }
    store.saveLearning({
      ...learning,
      writingHistory: [
        { ...base, at: '2026-01-03T00:00:00.000Z', source: 'goldenSentence', sentenceId: 's1' },
        { ...base, at: '2026-01-04T00:00:00.000Z', source: 'goldenExam', examId: 'e1' },
        { ...base, at: '2026-01-06T00:00:00.000Z', source: 'goldenError', sentenceId: 's1' },
        { ...base, at: '2026-01-05T00:00:00.000Z', source: 'bogus' },
      ],
    })
    const got = store.loadLearning().writingHistory
    // 按 at 倒序：01-06 错因订正，01-05 坏值 → 普通仿写（undefined），01-04 考试，01-03 单句
    expect(got.map((r) => r.source)).toEqual(['goldenError', undefined, 'goldenExam', 'goldenSentence'])
    expect(at(got, 2).examId).toBe('e1')
    expect(at(got, 3).sentenceId).toBe('s1')
  })

  it('答题事件增量同步幂等：重复 section 不翻倍，也不会被空数组删除', async () => {
    const store = mustOpen(tempDb())
    store.saveLearningPartial({ answerEvents: learning.answerEvents })
    store.saveLearningPartial({ answerEvents: learning.answerEvents })
    expect(store.loadLearning().answerEvents).toHaveLength(2)

    // 整份保存时旧客户端没带 events（undefined / []）也不能清掉审计日志
    store.saveLearning({ ...learning, answerEvents: [] })
    expect(store.loadLearning().answerEvents).toHaveLength(2)
  })

  it('回译存档增量同步幂等：重复同步不翻倍，整份空数组也不清历史', async () => {
    const store = mustOpen(tempDb())
    store.saveLearningPartial({ backTranslations: learning.backTranslations })
    store.saveLearningPartial({ backTranslations: learning.backTranslations })
    expect(store.loadLearning().backTranslations).toHaveLength(1)

    store.saveLearning({ ...learning, backTranslations: [] })
    expect(store.loadLearning().backTranslations).toHaveLength(1)
  })

  it('错因复习状态增量同步幂等：重复同步不翻倍，整份空数组也不清历史', async () => {
    const store = mustOpen(tempDb())
    store.saveLearningPartial({ writingErrorProgress: learning.writingErrorProgress })
    store.saveLearningPartial({ writingErrorProgress: learning.writingErrorProgress })
    expect(store.loadLearning().writingErrorProgress).toHaveLength(1)

    store.saveLearning({ ...learning, writingErrorProgress: [] })
    expect(store.loadLearning().writingErrorProgress).toHaveLength(1)
  })

  it('目标块进度增量同步幂等：重复写不翻倍，孤儿行会被清掉', async () => {
    const store = mustOpen(tempDb())
    const row = {
      key: 'word:run',
      kind: 'word',
      text: 'run',
      meaning: '跑',
      attempts: 2,
      hits: 1,
      misses: 1,
      streak: 0,
      lastAt: '2026-11-01T00:00:00.000Z',
      dueAt: '2026-11-02T00:00:00.000Z',
      updatedAt: '2026-11-01T00:00:00.000Z',
    }
    store.saveLearningPartial({ productionProgress: [row] })
    store.saveLearningPartial({ productionProgress: [row] })
    expect(store.loadLearning().productionProgress).toHaveLength(1)
    expect(firstItem(store.loadLearning().productionProgress)).toMatchObject({ key: 'word:run', attempts: 2 })

    store.saveLearningPartial({
      productionProgress: [{ ...row, key: 'word:walk', text: 'walk' }],
    })
    expect(store.loadLearning().productionProgress.map((r) => r.key)).toEqual(['word:walk'])

    store.saveLearning({ ...learning, productionProgress: [] })
    expect(store.loadLearning().productionProgress).toHaveLength(0)
  })

  it('partial 拒绝未知 section，避免拼错字段静默丢数据', async () => {
    const store = mustOpen(tempDb())
    expect(() => store.saveLearningPartial({ practise: [] })).toThrow('未知学习记录 section')
  })

  it('答题事件只重建题型统计；活动聚合原样保留（含非答题活动）', async () => {
    const store = mustOpen(tempDb())
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
      activity: [{ day: '2026-01-01', counts: { vocab: 2, speak: 3 } }],
      kindStats: {},
      answerEvents: [
        { at: '2026-01-05T10:00:00.000Z', day: '2026-01-05', articleId: 'a1', source: 'quiz', kind: 'cloze', cat: 'vocab', correct: true },
        { at: '2026-01-05T10:01:00.000Z', day: '2026-01-05', articleId: 'a1', source: 'quiz', kind: 'cloze', cat: 'vocab', correct: false },
        { at: '2026-01-05T10:02:00.000Z', day: '2026-01-05', articleId: 'a1', source: 'dictation', kind: 'dictation', cat: 'listen', correct: true },
      ],
    })

    store.rebuildLearningDerived()

    const got = store.loadLearning()
    // 活动只写聚合、不产生事件，重建不能把它抹掉，也不能把事件重复加一遍
    expect(got.activity).toEqual([{ day: '2026-01-01', counts: { speak: 3, vocab: 2 } }])
    expect(got.kindStats).toEqual({ a1: { cloze: { total: 4, correct: 3 } } })
    // 其它学习记录不受影响
    expect(got.practice).toHaveLength(2)
  })

  it('if-empty 只在服务端没有任何学习记录时迁移', async () => {
    const store = mustOpen(tempDb())
    const first = store.migrateLearning(learning)
    expect(first.migrated).toBe(true)
    expect(first.value.practice).toHaveLength(2)

    const second = store.migrateLearning({ ...learning, practice: [] })
    expect(second.migrated).toBe(false)
    expect(second.value.practice).toHaveLength(2)
  })

  it('导出包含学习记录', async () => {
    const store = mustOpen(tempDb())
    store.saveLearning(learning)
    expect(store.exportAll().learning.practice).toHaveLength(2)
  })

  it('学习快照：自动节流、手动拍一张、覆盖后能恢复且保留新答题事件', () => {
    const store = mustOpen(tempDb())
    store.saveLearning(learning)

    // 第一次 partial：上一张不存在，拍一张自动快照（内容是刚写进去的学习记录）
    store.saveLearningPartial({ practice: learning.practice })
    expect(store.listLearningSnapshots().length).toBeGreaterThan(0)

    // 内容没变 + 10 分钟内：自动快照不再写；手动也走 dedupe
    const count = store.listLearningSnapshots().length
    store.saveLearningPartial({ practice: learning.practice })
    expect(store.listLearningSnapshots().length).toBe(count)
    expect(store.snapshotLearning('manual')).toBeNull()

    // 改一点再手动拍，作为恢复点
    const extra = { at: '2026-03-01T00:00:00.000Z', kind: 'quiz', total: 1, correct: 1 }
    store.saveLearningPartial({ practice: [...learning.practice, extra] })
    const snapAt = store.snapshotLearning('manual')
    expect(snapAt).toBeTruthy()
    if (!snapAt) throw new Error('手动快照没生成')

    // 整份覆盖成空练习
    store.saveLearning({ ...learning, practice: [] })
    expect(store.loadLearning().practice).toHaveLength(0)

    // 覆盖后新增答题事件；恢复旧快照时 append-only，新的不能丢
    const newer = { ...learning.answerEvents[0], at: '2026-04-01T00:00:00.000Z', questionId: 'q-new' }
    store.saveLearningPartial({ answerEvents: [...learning.answerEvents, newer] })

    expect(store.restoreLearningSnapshot(snapAt)).toBe(true)
    const restored = store.loadLearning()
    expect(restored.practice).toHaveLength(3)
    expect(restored.answerEvents.some((e) => e.questionId === 'q-new')).toBe(true)
    expect(store.listLearningSnapshots().some((s) => s.reason === 'before-restore')).toBe(true)
    expect(store.restoreLearningSnapshot('1999-01-01T00:00:00.000Z')).toBe(false)
  })

  it('老库的 v5 learning_snapshots 会归档成 _v5，v12 新表能正常拍快照', () => {
    const path = tempDb()
    const first = mustOpen(path)
    first.close()

    // 造一个 v11 库：把 v12 的新表换回 v5 结构
    const raw = openDb(path)
    raw.exec('DROP TABLE learning_snapshots')
    raw.exec(`CREATE TABLE learning_snapshots (
      id INTEGER PRIMARY KEY,
      at TEXT NOT NULL,
      reason TEXT NOT NULL DEFAULT '',
      record_count INTEGER NOT NULL DEFAULT 0,
      payload TEXT NOT NULL
    )`)
    raw
      .prepare('INSERT INTO learning_snapshots (at, reason, record_count, payload) VALUES (?, ?, ?, ?)')
      .run('2026-01-01T00:00:00.000Z', 'auto', 1, '{"practice":[]}')
    raw.exec('PRAGMA user_version = 11')
    raw.close()

    const store = mustOpen(path)
    const check = openDb(path, { readOnly: true })
    expect(Number(check.prepare('PRAGMA user_version').get().user_version)).toBe(SCHEMA_VERSION)
    expect(Number(check.prepare('SELECT COUNT(*) AS n FROM learning_snapshots_v5').get().n)).toBe(1)
    const cols = check.prepare('PRAGMA table_info(learning_snapshots)').all().map((r) => String(r.name))
    check.close()
    expect(cols).toContain('bytes')

    store.saveLearning({
      practice: [{ at: '2026-01-02T00:00:00.000Z', kind: 'quiz', total: 1, correct: 1 }],
    })
    store.saveLearningPartial({
      practice: [{ at: '2026-01-02T00:00:00.000Z', kind: 'quiz', total: 1, correct: 1 }],
    })
    expect(store.listLearningSnapshots().length).toBeGreaterThan(0)
  })
})

describe('sqliteStore：重建派生聚合', () => {
  it('重建只动题型统计，不抹掉背单词/跟读等非答题活动', async () => {
    const store = mustOpen(tempDb())
    store.saveLearning({
      practice: [],
      mistakes: [],
      readDone: [],
      writingHistory: [],
      retells: [],
      activity: [
        { day: '2026-10-19', counts: { vocab: 4, speak: 2 } },
        { day: '2026-10-20', counts: { read: 1, write: 1 } },
      ],
      studyDays: [],
      sessions: [],
      studiedDays: [],
      skimmed: [],
      kindStats: {},
      answerEvents: [],
    })

    const activity = store.rebuildLearningDerived()
    expect(activity).toEqual([
      { day: '2026-10-19', counts: { speak: 2, vocab: 4 } },
      { day: '2026-10-20', counts: { read: 1, write: 1 } },
    ])
  })
})

describe('sqliteStore：v1 → v7 迁移', () => {
  it('旧库的 JSON 会自动回填派生表，并把标题形式的文章 id 换成真 id', async () => {
    const path = tempDb()
    const old = openDb(path)
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

    const store = mustOpen(path)
    expect(Number(store.db.prepare('PRAGMA user_version').get().user_version)).toBe(SCHEMA_VERSION)
    // 迁移前整库备份，出事能回到 v1。
    const backups = readdirSync(join(dirname(path), 'backups'))
    const migrationBackups = backups.filter((name) => /^xueba-v1-.*\.db$/.test(name))
    expect(migrationBackups).toHaveLength(1)
    expect(backups.some((name) => /^xueba-daily-.*\.db$/.test(name))).toBe(true)
    const saved = firstItem(vocab(store).items)
    expect(saved.source?.articleId).toBe('a1')
    expect(saved.examples?.[0]?.articleId).toBe('a1')
    expect(saved.contexts?.[0]?.articleId).toBe('a1')
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