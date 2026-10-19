import { list, nowIso, num, text } from './sqliteUtil.js'

/**
 * 学习记录的 SQLite 读写。
 *
 * 这里只放规范化的事实表（练习、错题、读完、写作、复述、活动、背词/选词）。
 * 偏好/会话状态不在这里，仍留在 localStorage。
 */

export const LEARNING_SECTION_TABLES = {
  practice: ['practice_records'],
  mistakes: ['mistake_records'],
  readDone: ['reading_progress'],
  writingHistory: ['writing_records'],
  retells: ['retell_records'],
  activity: ['activity_days'],
  studyDays: ['study_days'],
  sessions: ['pick_sessions'],
  studiedDays: ['study_word_days'],
  skimmed: ['skimmed_articles'],
  kindStats: ['kind_stats'],
}

export const LEARNING_SECTIONS = Object.keys(LEARNING_SECTION_TABLES)
export const LEARNING_TABLES = [...new Set(Object.values(LEARNING_SECTION_TABLES).flat())]

export function emptyLearning() {
  return {
    practice: [],
    mistakes: [],
    readDone: [],
    writingHistory: [],
    retells: [],
    activity: [],
    studyDays: [],
    sessions: [],
    studiedDays: [],
    skimmed: [],
    kindStats: {},
  }
}

function jsonText(v) {
  if (v === undefined || v === null) return null
  try {
    return JSON.stringify(v)
  } catch {
    return null
  }
}

function parseJson(v) {
  if (v === undefined || v === null || v === '') return undefined
  try {
    return JSON.parse(String(v))
  } catch {
    return undefined
  }
}

function assertLearning(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new Error('学习记录格式不对：需要对象')
  }
  for (const key of [
    'practice',
    'mistakes',
    'readDone',
    'writingHistory',
    'retells',
    'activity',
    'studyDays',
    'sessions',
    'studiedDays',
    'skimmed',
  ]) {
    if (data[key] !== undefined && !Array.isArray(data[key])) {
      throw new Error(`学习记录 ${key} 必须是数组`)
    }
  }
  if (
    data.kindStats !== undefined &&
    (!data.kindStats || typeof data.kindStats !== 'object' || Array.isArray(data.kindStats))
  ) {
    throw new Error('学习记录 kindStats 必须是对象')
  }
}

function clearLearningSections(db, sections) {
  const tables = new Set()
  for (const section of sections) {
    for (const table of LEARNING_SECTION_TABLES[section] ?? []) tables.add(table)
  }
  for (const table of tables) db.prepare(`DELETE FROM ${table}`).run()
}

function writePractice(db, data) {
  const insert = db.prepare(
    'INSERT INTO practice_records (at, kind, total, correct, seconds, article_id) VALUES (?, ?, ?, ?, ?, ?)',
  )
  for (const r of list(data.practice)) {
    if (!r || typeof r !== 'object') continue
    insert.run(
      text(r.at) ?? nowIso(),
      text(r.kind) ?? 'quiz',
      num(r.total),
      num(r.correct),
      Number.isFinite(Number(r.seconds)) ? Number(r.seconds) : null,
      text(r.articleId),
    )
  }
}

function writeMistakes(db, data) {
  const insert = db.prepare(`
    INSERT OR REPLACE INTO mistake_records
      (id, kind, at, count, label, item_id, question_json, article_id, text)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)
  for (const r of list(data.mistakes)) {
    if (!r || typeof r !== 'object' || typeof r.id !== 'string') continue
    insert.run(
      r.id,
      text(r.kind) ?? 'vocab',
      text(r.at) ?? nowIso(),
      Math.max(1, num(r.count, 1)),
      text(r.label) ?? '',
      text(r.itemId),
      jsonText(r.question),
      text(r.articleId),
      text(r.text),
    )
  }
}

function writeReadDone(db, data) {
  const insert = db.prepare(
    'INSERT OR REPLACE INTO reading_progress (article_id, day, title, at) VALUES (?, ?, ?, ?)',
  )
  for (const r of list(data.readDone)) {
    if (!r || typeof r !== 'object' || typeof r.articleId !== 'string' || !r.articleId) continue
    insert.run(r.articleId, text(r.day) ?? '', text(r.title) ?? '', text(r.at) ?? nowIso())
  }
}

function writeWriting(db, data) {
  const insert = db.prepare(`
    INSERT INTO writing_records (at, article_id, article_title, model, text, feedback_json, task_json)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `)
  for (const r of list(data.writingHistory)) {
    if (!r || typeof r !== 'object') continue
    insert.run(
      text(r.at) ?? nowIso(),
      text(r.articleId) ?? '',
      text(r.articleTitle),
      text(r.model) ?? '',
      text(r.text) ?? '',
      jsonText(r.feedback) ?? '{}',
      jsonText(r.task),
    )
  }
}

function writeRetells(db, data) {
  const insert = db.prepare(
    'INSERT INTO retell_records (at, article_id, text, words) VALUES (?, ?, ?, ?)',
  )
  for (const r of list(data.retells)) {
    if (!r || typeof r !== 'object' || typeof r.articleId !== 'string') continue
    insert.run(text(r.at) ?? nowIso(), r.articleId, text(r.text) ?? '', num(r.words))
  }
}

function writeActivity(db, data) {
  const insert = db.prepare(
    'INSERT OR REPLACE INTO activity_days (day, cat, count) VALUES (?, ?, ?)',
  )
  for (const day of list(data.activity)) {
    if (!day || typeof day !== 'object' || typeof day.day !== 'string') continue
    const counts = day.counts && typeof day.counts === 'object' ? day.counts : {}
    for (const [cat, count] of Object.entries(counts)) insert.run(day.day, cat, num(count))
  }
}

function writeStudyDays(db, data) {
  const insert = db.prepare(
    'INSERT OR REPLACE INTO study_days (day, seconds, cards) VALUES (?, ?, ?)',
  )
  for (const r of list(data.studyDays)) {
    if (!r || typeof r !== 'object' || typeof r.day !== 'string') continue
    insert.run(r.day, num(r.seconds), num(r.cards))
  }
}

function writeSessions(db, data) {
  const insert = db.prepare('INSERT INTO pick_sessions (at, seconds, picked) VALUES (?, ?, ?)')
  for (const r of list(data.sessions)) {
    if (!r || typeof r !== 'object') continue
    insert.run(text(r.at) ?? nowIso(), num(r.seconds), num(r.picked))
  }
}

function writeStudiedDays(db, data) {
  const insert = db.prepare(
    'INSERT OR IGNORE INTO study_word_days (day, word_id, ordinal) VALUES (?, ?, ?)',
  )
  for (const r of list(data.studiedDays)) {
    if (!r || typeof r !== 'object' || typeof r.day !== 'string') continue
    list(r.ids).forEach((id, ordinal) => {
      if (typeof id === 'string' && id) insert.run(r.day, id, ordinal)
    })
  }
}

function writeSkimmed(db, data) {
  const insert = db.prepare('INSERT OR IGNORE INTO skimmed_articles (article_id) VALUES (?)')
  for (const id of list(data.skimmed)) {
    if (typeof id === 'string' && id) insert.run(id)
  }
}

function writeKindStats(db, data) {
  const insert = db.prepare(
    'INSERT OR REPLACE INTO kind_stats (article_id, kind, total, correct) VALUES (?, ?, ?, ?)',
  )
  if (!data.kindStats || typeof data.kindStats !== 'object') return
  for (const [articleId, byKind] of Object.entries(data.kindStats)) {
    if (!byKind || typeof byKind !== 'object') continue
    for (const [kind, stat] of Object.entries(byKind)) {
      if (!stat || typeof stat !== 'object') continue
      insert.run(articleId, kind, num(stat.total), num(stat.correct))
    }
  }
}

const WRITERS = {
  practice: writePractice,
  mistakes: writeMistakes,
  readDone: writeReadDone,
  writingHistory: writeWriting,
  retells: writeRetells,
  activity: writeActivity,
  studyDays: writeStudyDays,
  sessions: writeSessions,
  studiedDays: writeStudiedDays,
  skimmed: writeSkimmed,
  kindStats: writeKindStats,
}

/**
 * 学习记录 → 独立表。
 * 默认整份替换；传 `only` 时只替换指定 section，避免改一条练习就重写整份记录。
 */
export function writeLearning(db, data, only) {
  assertLearning(data)
  const sections = only ? [...new Set(only)] : LEARNING_SECTIONS
  clearLearningSections(db, sections)
  for (const section of sections) WRITERS[section](db, data)
}

export function hasLearningRows(db) {
  for (const table of LEARNING_TABLES) {
    const row = db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get()
    if (Number(row?.n ?? 0) > 0) return true
  }
  return false
}

export function loadLearning(db) {
  const out = emptyLearning()

  out.practice = db
    .prepare('SELECT at, kind, total, correct, seconds, article_id FROM practice_records ORDER BY at ASC, id ASC')
    .all()
    .map((r) => {
      const rec = {
        at: String(r.at),
        kind: String(r.kind),
        total: Number(r.total),
        correct: Number(r.correct),
      }
      if (r.seconds !== null && r.seconds !== undefined) rec.seconds = Number(r.seconds)
      if (r.article_id !== null && r.article_id !== undefined) rec.articleId = String(r.article_id)
      return rec
    })

  out.mistakes = db
    .prepare(
      'SELECT id, kind, at, count, label, item_id, question_json, article_id, text FROM mistake_records ORDER BY at DESC',
    )
    .all()
    .map((r) => {
      const rec = {
        id: String(r.id),
        kind: String(r.kind),
        at: String(r.at),
        count: Number(r.count),
        label: String(r.label ?? ''),
      }
      if (r.item_id !== null) rec.itemId = String(r.item_id)
      const question = parseJson(r.question_json)
      if (question !== undefined) rec.question = question
      if (r.article_id !== null) rec.articleId = String(r.article_id)
      if (r.text !== null) rec.text = String(r.text)
      return rec
    })

  out.readDone = db
    .prepare('SELECT article_id, day, title, at FROM reading_progress ORDER BY at ASC')
    .all()
    .map((r) => ({
      articleId: String(r.article_id),
      day: String(r.day),
      title: String(r.title),
      at: String(r.at),
    }))

  out.writingHistory = db
    .prepare(
      'SELECT at, article_id, article_title, model, text, feedback_json, task_json FROM writing_records ORDER BY at DESC, id DESC',
    )
    .all()
    .map((r) => {
      const rec = {
        at: String(r.at),
        articleId: String(r.article_id ?? ''),
        model: String(r.model ?? ''),
        text: String(r.text ?? ''),
        feedback: parseJson(r.feedback_json) ?? {},
      }
      if (r.article_title !== null) rec.articleTitle = String(r.article_title)
      const task = parseJson(r.task_json)
      if (task !== undefined) rec.task = task
      return rec
    })

  out.retells = db
    .prepare('SELECT at, article_id, text, words FROM retell_records ORDER BY at DESC, id DESC')
    .all()
    .map((r) => ({
      at: String(r.at),
      articleId: String(r.article_id),
      text: String(r.text ?? ''),
      words: Number(r.words),
    }))

  const activity = new Map()
  for (const r of db.prepare('SELECT day, cat, count FROM activity_days ORDER BY day ASC, cat ASC').all()) {
    const day = String(r.day)
    if (!activity.has(day)) activity.set(day, { day, counts: {} })
    activity.get(day).counts[String(r.cat)] = Number(r.count)
  }
  out.activity = [...activity.values()]

  out.studyDays = db
    .prepare('SELECT day, seconds, cards FROM study_days ORDER BY day ASC')
    .all()
    .map((r) => ({ day: String(r.day), seconds: Number(r.seconds), cards: Number(r.cards) }))

  out.sessions = db
    .prepare('SELECT at, seconds, picked FROM pick_sessions ORDER BY at ASC, id ASC')
    .all()
    .map((r) => ({ at: String(r.at), seconds: Number(r.seconds), picked: Number(r.picked) }))

  const studied = new Map()
  for (const r of db.prepare('SELECT day, word_id FROM study_word_days ORDER BY day ASC, ordinal ASC').all()) {
    const day = String(r.day)
    if (!studied.has(day)) studied.set(day, { day, ids: [] })
    studied.get(day).ids.push(String(r.word_id))
  }
  out.studiedDays = [...studied.values()]

  out.skimmed = db
    .prepare('SELECT article_id FROM skimmed_articles ORDER BY article_id ASC')
    .all()
    .map((r) => String(r.article_id))

  for (const r of db
    .prepare('SELECT article_id, kind, total, correct FROM kind_stats ORDER BY article_id ASC, kind ASC')
    .all()) {
    const articleId = String(r.article_id)
    if (!out.kindStats[articleId]) out.kindStats[articleId] = {}
    out.kindStats[articleId][String(r.kind)] = {
      total: Number(r.total),
      correct: Number(r.correct),
    }
  }

  return out
}
