import { list, nowIso, num, text } from './sqliteUtil.js'
import { LEARNING_SECTION_TABLES } from './sqliteLearningSections.js'

/**
 * 学习记录的写入侧：每个 section 一套「先清后插」的写库语句。
 *
 * 从 `sqliteLearning.js` 抽出来的原因：写入（12 张表的 prepare/run）和读取
 * （12 段 row → 对象映射）是两套对称但独立的长代码，加起来把文件撑到 600 多行。
 * 这里只负责把一份 JSON 摊进表里；快照、校验、读回仍在 `sqliteLearning.js`。
 */

function jsonText(v) {
  if (v === undefined || v === null) return null
  try {
    return JSON.stringify(v)
  } catch {
    return null
  }
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

function writeKindStats(db, data) {  const insert = db.prepare(
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

function writeAnswerEvents(db, data) {
  const insert = db.prepare(`
    INSERT OR IGNORE INTO answer_events (at, day, article_id, source, kind, cat, correct, question_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `)
  for (const ev of list(data.answerEvents)) {
    if (!ev || typeof ev !== 'object') continue
    if (typeof ev.at !== 'string' || typeof ev.source !== 'string') continue
    if (typeof ev.kind !== 'string' || typeof ev.cat !== 'string') continue
    insert.run(
      ev.at,
      text(ev.day) ?? '',
      text(ev.articleId) ?? '',
      ev.source,
      ev.kind,
      ev.cat,
      ev.correct ? 1 : 0,
      text(ev.questionId),
    )
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
  answerEvents: writeAnswerEvents,
}

/** 清掉指定 section 对应的表（答题事件是 append-only，永远不清）。 */
export function clearLearningSections(db, sections) {
  const tables = new Set()
  for (const section of sections) {
    // 答题事件是 append-only 审计：同步只追加/去重，不因整份保存或旧快照恢复而删除。
    if (section === 'answerEvents') continue
    for (const table of LEARNING_SECTION_TABLES[section] ?? []) tables.add(table)
  }
  for (const table of tables) db.prepare(`DELETE FROM ${table}`).run()
}

/** 把一份学习记录按 section 写进表（调用方负责事务与快照）。 */
export function writeSections(db, data, sections) {
  clearLearningSections(db, sections)
  for (const section of sections) {
    const write = WRITERS[section]
    if (write) write(db, data)
  }
}
