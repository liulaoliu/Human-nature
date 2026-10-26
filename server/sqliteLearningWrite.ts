import type { DatabaseSync } from 'node:sqlite'
import { list, nowIso, num, text } from './sqliteUtil.ts'
import { LEARNING_SECTION_TABLES } from './sqliteLearningSections.ts'
import { isRecord, asRecord } from './types/guards.ts'

/**
 * 学习记录的写入侧：每个 section 一套「先清后插」的写库语句。
 *
 * 从 `sqliteLearning.js` 抽出来的原因：写入（13 张表的 prepare/run）和读取
 * （13 段 row → 对象映射）是两套对称但独立的长代码，加起来把文件撑到 600 多行。
 * 这里只负责把一份 JSON 摊进表里；快照、校验、读回仍在 `sqliteLearning.js`。
 */

// data 是学习记录 JSON 的 parse 结果（形状不可信）。写入侧统一：
// 容器字段先 list()/asRecord() 收窄，条目 isRecord 过滤，
// 单个字段靠 text/num 兜底 —— 坏形状按「字段为空 / 整条跳过」处理，不抛错。
type LearningData = Record<string, unknown>

function jsonText(v: unknown): string | null {
  if (v === undefined || v === null) return null
  try {
    return JSON.stringify(v)
  } catch {
    return null
  }
}

function writePractice(db: DatabaseSync, data: LearningData): void {
  const insert = db.prepare(
    'INSERT INTO practice_records (at, kind, total, correct, seconds, article_id) VALUES (?, ?, ?, ?, ?, ?)',
  )
  for (const r of list<unknown>(data.practice)) {
    if (!isRecord(r)) continue
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

function writeMistakes(db: DatabaseSync, data: LearningData): void {
  const insert = db.prepare(`
    INSERT OR REPLACE INTO mistake_records
      (id, kind, at, count, label, item_id, question_json, article_id, text)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)
  for (const r of list<unknown>(data.mistakes)) {
    if (!isRecord(r) || typeof r.id !== 'string') continue
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

function writeReadDone(db: DatabaseSync, data: LearningData): void {
  const insert = db.prepare(
    'INSERT OR REPLACE INTO reading_progress (article_id, day, title, at) VALUES (?, ?, ?, ?)',
  )
  for (const r of list<unknown>(data.readDone)) {
    if (!isRecord(r) || typeof r.articleId !== 'string' || !r.articleId) continue
    const articleId = r.articleId
    insert.run(articleId, text(r.day) ?? '', text(r.title) ?? '', text(r.at) ?? nowIso())
  }
}

function writeWriting(db: DatabaseSync, data: LearningData): void {
  const insert = db.prepare(`
    INSERT INTO writing_records (at, article_id, article_title, model, text, feedback_json, task_json)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `)
  for (const r of list<unknown>(data.writingHistory)) {
    if (!isRecord(r)) continue
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

function writeBackTranslations(db: DatabaseSync, data: LearningData): void {
  const insert = db.prepare(`
    INSERT OR REPLACE INTO back_translation_records
      (id, at, article_id, article_title, sentence_id, source_zh, context_zh, answer, reference, feedback_json, exact, ratio, graded_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)
  for (const r of list<unknown>(data.backTranslations)) {
    if (!isRecord(r) || typeof r.id !== 'string' || !r.id) continue
    if (typeof r.at !== 'string' || typeof r.sentenceId !== 'string') continue
    const closeness = isRecord(r.closeness) ? r.closeness : {}
    insert.run(
      r.id,
      r.at,
      text(r.articleId) ?? '',
      text(r.articleTitle),
      r.sentenceId,
      text(r.sourceZh) ?? '',
      text(r.contextZh),
      text(r.answer) ?? '',
      text(r.reference) ?? '',
      jsonText(r.feedback) ?? '{}',
      closeness.exact === true ? 1 : 0,
      num(closeness.ratio),
      text(r.gradedBy),
    )
  }
}

function writeRetells(db: DatabaseSync, data: LearningData): void {
  const insert = db.prepare(
    'INSERT INTO retell_records (at, article_id, text, words) VALUES (?, ?, ?, ?)',
  )
  for (const r of list<unknown>(data.retells)) {
    if (!isRecord(r) || typeof r.articleId !== 'string') continue
    insert.run(text(r.at) ?? nowIso(), r.articleId, text(r.text) ?? '', num(r.words))
  }
}

function writeActivity(db: DatabaseSync, data: LearningData): void {
  const insert = db.prepare(
    'INSERT OR REPLACE INTO activity_days (day, cat, count) VALUES (?, ?, ?)',
  )
  for (const day of list<unknown>(data.activity)) {
    if (!isRecord(day) || typeof day.day !== 'string') continue
    const dayKey = day.day
    // counts 只认对象；数组放行后 Object.entries 走索引，与旧 typeof 判断一致。
    const counts = asRecord(day.counts) ?? {}
    for (const [cat, count] of Object.entries(counts)) insert.run(dayKey, cat, num(count))
  }
}

function writeStudyDays(db: DatabaseSync, data: LearningData): void {
  const insert = db.prepare(
    'INSERT INTO study_days (day, seconds, cards) VALUES (?, ?, ?)',
  )
  for (const r of list<unknown>(data.studyDays)) {
    if (!isRecord(r) || typeof r.day !== 'string') continue
    const day = r.day
    insert.run(day, num(r.seconds), num(r.cards))
  }
}

function writeSessions(db: DatabaseSync, data: LearningData): void {
  const insert = db.prepare('INSERT INTO pick_sessions (at, seconds, picked) VALUES (?, ?, ?)')
  for (const r of list<unknown>(data.sessions)) {
    if (!isRecord(r)) continue
    insert.run(text(r.at) ?? nowIso(), num(r.seconds), num(r.picked))
  }
}

function writeStudiedDays(db: DatabaseSync, data: LearningData): void {
  const insert = db.prepare(
    'INSERT OR IGNORE INTO study_word_days (day, word_id, ordinal) VALUES (?, ?, ?)',
  )
  for (const r of list<unknown>(data.studiedDays)) {
    if (!isRecord(r) || typeof r.day !== 'string') continue
    const day = r.day
    list<unknown>(r.ids).forEach((id, ordinal) => {
      if (typeof id === 'string' && id) insert.run(day, id, ordinal)
    })
  }
}

function writeSkimmed(db: DatabaseSync, data: LearningData): void {
  const insert = db.prepare('INSERT OR IGNORE INTO skimmed_articles (article_id) VALUES (?)')
  for (const id of list<unknown>(data.skimmed)) {
    if (typeof id === 'string' && id) insert.run(id)
  }
}

function writeKindStats(db: DatabaseSync, data: LearningData): void {
  const insert = db.prepare(
    'INSERT OR REPLACE INTO kind_stats (article_id, kind, total, correct) VALUES (?, ?, ?, ?)',
  )
  if (!isRecord(data.kindStats)) return
  for (const [articleId, byKind] of Object.entries(data.kindStats)) {
    if (!isRecord(byKind)) continue
    for (const [kind, stat] of Object.entries(byKind)) {
      if (!isRecord(stat)) continue
      insert.run(articleId, kind, num(stat.total), num(stat.correct))
    }
  }
}

function writeAnswerEvents(db: DatabaseSync, data: LearningData): void {
  const insert = db.prepare(`
    INSERT OR IGNORE INTO answer_events (at, day, article_id, source, kind, cat, correct, question_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `)
  for (const ev of list<unknown>(data.answerEvents)) {
    if (!isRecord(ev)) continue
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

const WRITERS: Record<string, (db: DatabaseSync, data: LearningData) => void> = {
  practice: writePractice,
  mistakes: writeMistakes,
  readDone: writeReadDone,
  writingHistory: writeWriting,
  backTranslations: writeBackTranslations,
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
export function clearLearningSections(db: DatabaseSync, sections: string[]): void {
  const tables = new Set<string>()
  for (const section of sections) {
    // 答题事件是 append-only 审计：同步只追加/去重，不因整份保存或旧快照恢复而删除。
    if (section === 'answerEvents') continue
    // 回译存档同理：长期资产，绝不清表；写入用 INSERT OR REPLACE 按 id 去重。
    if (section === 'backTranslations') continue
    for (const table of LEARNING_SECTION_TABLES[section] ?? []) tables.add(table)
  }
  for (const table of tables) db.prepare(`DELETE FROM ${table}`).run()
}

/** 把一份学习记录按 section 写进表（调用方负责事务与快照）。 */
export function writeSections(db: DatabaseSync, data: unknown, sections: string[]): void {
  clearLearningSections(db, sections)
  const rec = asRecord(data) ?? {}
  for (const section of sections) {
    const write = WRITERS[section]
    if (write) write(db, rec)
  }
}
