import type { DatabaseSync } from 'node:sqlite'
import { nowIso, num } from './sqliteUtil.ts'
import { writeSections } from './sqliteLearningWrite.ts'
import { LEARNING_SECTIONS, LEARNING_TABLES } from './sqliteLearningSections.ts'
import { isRecord } from './types/guards.ts'

/**
 * 学习记录的 SQLite 读写。
 *
 * 这里只放规范化的事实表（练习、错题、读完、写作、复述、活动、背词/选词）。
 * 偏好/会话状态不在这里，仍留在 localStorage。
 */

export { LEARNING_SECTIONS, LEARNING_SECTION_TABLES, LEARNING_TABLES } from './sqliteLearningSections.ts'

/**
 * 读侧返回的学习记录形状。
 *
 * 有意**不复用**前端 `src/core/learning.ts` 的 LearningData：那里的字段是
 * 字面量联合（如 `kind: PracticeKind`）且多数必填，而后端从 SQLite row
 * `String()`/`Number()` 出来的是普通 string/number、个别字段（seconds /
 * articleId / itemId / question）只在非空时才挂上。持久化边界用宽松形状，
 * 交给前端 `normalizeLearning` 做严格收窄 —— 规范 §4.2 的守卫职责分层。
 */
export interface LearningOut {
  practice: LearningPractice[]
  mistakes: LearningMistake[]
  readDone: LearningReadDone[]
  writingHistory: LearningWriting[]
  retells: LearningRetell[]
  activity: LearningDayActivity[]
  studyDays: LearningStudyDay[]
  sessions: LearningSession[]
  studiedDays: LearningStudiedDay[]
  skimmed: string[]
  kindStats: Record<string, Record<string, { total: number; correct: number }>>
  answerEvents: LearningAnswerEvent[]
}

export interface LearningPractice {
  at: string
  kind: string
  total: number
  correct: number
  seconds?: number
  articleId?: string
}

export interface LearningMistake {
  id: string
  kind: string
  at: string
  count: number
  label: string
  itemId?: string
  question?: unknown
  articleId?: string
  text?: string
}

export interface LearningReadDone {
  articleId: string
  day: string
  title: string
  at: string
}

export interface LearningWriting {
  at: string
  articleId: string
  model: string
  text: string
  feedback: unknown
  articleTitle?: string
  task?: unknown
}

export interface LearningRetell {
  at: string
  articleId: string
  text: string
  words: number
}

export interface LearningDayActivity {
  day: string
  counts: Record<string, number>
}

export interface LearningStudyDay {
  day: string
  seconds: number
  cards: number
}

export interface LearningSession {
  at: string
  seconds: number
  picked: number
}

export interface LearningStudiedDay {
  day: string
  ids: string[]
}

export interface LearningAnswerEvent {
  at: string
  day: string
  articleId: string
  source: string
  kind: string
  cat: string
  correct: boolean
  questionId?: string
}

export function emptyLearning(): LearningOut {
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
    answerEvents: [],
  }
}

// 注：原 JS 里有个从未被调用的私有 `jsonText`（写侧 sqliteLearningWrite 有同名函数
// 才是真正在用的那个）。迁移时按 noUnusedLocals 移除死代码，行为不变。

function parseJson(v: unknown): unknown {
  if (v === undefined || v === null || v === '') return undefined
  try {
    return JSON.parse(String(v))
  } catch {
    return undefined
  }
}

// data 是学习记录 JSON（调用方传入）。这里只做形状校验，失败抛错（不是静默吞），
// 与规范 §4.2「不能静默把坏数据变成空库」对齐。
function assertLearning(data: unknown): asserts data is Record<string, unknown> {
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new Error('学习记录格式不对：需要对象')
  }
  const rec = data as Record<string, unknown>
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
    'answerEvents',
  ]) {
    if (rec[key] !== undefined && !Array.isArray(rec[key])) {
      throw new Error(`学习记录 ${key} 必须是数组`)
    }
  }
  if (
    rec.kindStats !== undefined &&
    (!rec.kindStats || typeof rec.kindStats !== 'object' || Array.isArray(rec.kindStats))
  ) {
    throw new Error('学习记录 kindStats 必须是对象')
  }
}

export const LEARNING_SNAPSHOT_KEEP = 30

function countLearningRecords(value: LearningOut): number {
  let n = 0
  for (const section of LEARNING_SECTIONS) {
    if (section === 'kindStats') n += Object.keys(value.kindStats).length
    else if (section === 'practice') n += value.practice.length
    else if (section === 'mistakes') n += value.mistakes.length
    else if (section === 'readDone') n += value.readDone.length
    else if (section === 'writingHistory') n += value.writingHistory.length
    else if (section === 'retells') n += value.retells.length
    else if (section === 'activity') n += value.activity.length
    else if (section === 'studyDays') n += value.studyDays.length
    else if (section === 'sessions') n += value.sessions.length
    else if (section === 'studiedDays') n += value.studiedDays.length
    else if (section === 'skimmed') n += value.skimmed.length
    else if (section === 'answerEvents') n += value.answerEvents.length
  }
  return n
}

function pruneLearningSnapshots(db: DatabaseSync): void {
  const rows = db
    .prepare('SELECT id, record_count FROM learning_snapshots ORDER BY id ASC')
    .all()
  if (rows.length <= LEARNING_SNAPSHOT_KEEP + 1) return
  const keep = new Set<number>(rows.slice(-LEARNING_SNAPSHOT_KEEP).map((r) => Number(r.id)))
  // 再保住“记录最多”的那一份：连续删改后，最大快照往往是最完整的历史。
  let largest: (typeof rows)[number] | undefined = rows[0]
  for (const r of rows) {
    if (Number(r.record_count) > Number(largest?.record_count ?? 0)) largest = r
  }
  if (largest) keep.add(Number(largest.id))
  const del = db.prepare('DELETE FROM learning_snapshots WHERE id = ?')
  for (const r of rows) {
    if (!keep.has(Number(r.id))) del.run(Number(r.id))
  }
}

/**
 * 在覆盖学习记录之前留一份完整快照。
 *
 * 空库不写快照；和上一份内容完全相同也不重复写，避免防抖保存把快照表刷满。
 * 必须在调用方的事务里执行，失败时和写入一起回滚。
 */
export function snapshotLearning(db: DatabaseSync, reason = 'before-write'): number {
  if (!hasLearningRows(db)) return 0
  const value = loadLearning(db)
  const payload = JSON.stringify(value)
  const last = db.prepare('SELECT payload FROM learning_snapshots ORDER BY id DESC LIMIT 1').get()
  if (last && String(last.payload) === payload) return 0
  const info = db
    .prepare(
      'INSERT INTO learning_snapshots (at, reason, record_count, payload) VALUES (?, ?, ?, ?)',
    )
    .run(nowIso(), String(reason), countLearningRecords(value), payload)
  pruneLearningSnapshots(db)
  return Number(info.lastInsertRowid ?? 0)
}

export interface LearningSnapshotMeta {
  id: number
  at: string
  reason: string
  recordCount: number
}

export function listLearningSnapshots(db: DatabaseSync): LearningSnapshotMeta[] {
  return db
    .prepare(
      'SELECT id, at, reason, record_count FROM learning_snapshots ORDER BY id DESC',
    )
    .all()
    .map((r) => ({
      id: Number(r.id),
      at: String(r.at),
      reason: String(r.reason ?? ''),
      recordCount: Number(r.record_count),
    }))
}

export interface LearningSnapshot extends LearningSnapshotMeta {
  value: LearningOut
}

export function loadLearningSnapshot(db: DatabaseSync, id: number | string): LearningSnapshot | null {
  const row = db
    .prepare('SELECT id, at, reason, record_count, payload FROM learning_snapshots WHERE id = ?')
    .get(Number(id))
  if (!row) return null
  const value = parseJson(row.payload)
  if (value === undefined) return null
  return {
    id: Number(row.id),
    at: String(row.at),
    reason: String(row.reason ?? ''),
    recordCount: Number(row.record_count),
    value: value as LearningOut,
  }
}

const PARTIAL_SNAPSHOT_MS = 5 * 60_000

/** 增量写是否该留快照：没有上一份或已超过 5 分钟。 */
function shouldSnapshotPartial(db: DatabaseSync): boolean {
  const last = db.prepare('SELECT at FROM learning_snapshots ORDER BY id DESC LIMIT 1').get()
  if (!last) return true
  const at = Date.parse(String(last.at))
  return !Number.isFinite(at) || Date.now() - at >= PARTIAL_SNAPSHOT_MS
}

/** 恢复前会先把“当前状态”再存一份快照，恢复错了还能回来。 */
export function restoreLearningSnapshot(db: DatabaseSync, id: number | string): LearningSnapshot | null {
  const snap = loadLearningSnapshot(db, id)
  if (!snap) return null
  // 答题事件是 append-only 审计：旧快照没这个字段时保留当前事件，别用恢复动作删掉。
  const current = loadLearning(db)
  const value: LearningOut = {
    ...snap.value,
    answerEvents: snap.value.answerEvents ?? current.answerEvents,
  }
  writeLearning(db, value)
  return { ...snap, value: loadLearning(db) }
}

/**
 * 学习记录 → 独立表。
 * 默认整份替换；传 `only` 时只替换指定 section，避免改一条练习就重写整份记录。
 * 每次写之前自动快照当前状态（在同一事务里）。
 */
export function writeLearning(db: DatabaseSync, data: unknown, only?: string[]): void {
  assertLearning(data)
  const sections = only ? [...new Set(only)] : [...LEARNING_SECTIONS]
  // 增量写（答题后防抖同步）非常频繁；每次都整份快照会放大 IO。
  // 整份替换必留快照；增量最多每 5 分钟留一份，足够回退又不拖慢输入。
  if (!only || shouldSnapshotPartial(db)) snapshotLearning(db, only ? 'before-partial' : 'before-write')
  writeSections(db, data, sections)
}

export function hasLearningRows(db: DatabaseSync): boolean {
  for (const table of LEARNING_TABLES) {
    const row = db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get()
    if (Number(row?.n ?? 0) > 0) return true
  }
  return false
}

/**
 * 迁移 v7 时把「历史聚合」存成 baseline。
 *
 * 历史数据没有逐题事件，不能假装能重算；baseline 代表「事件出现之前的总量」，
 * 以后用 baseline + answer_events 重建，口径才诚实。
 */
export function saveDerivedBaseline(db: DatabaseSync, at = nowIso()): string {
  const value = loadLearning(db)
  const payload = JSON.stringify({ activity: value.activity, kindStats: value.kindStats })
  db.prepare('INSERT OR REPLACE INTO learning_derived_baseline (id, payload, at) VALUES (1, ?, ?)').run(
    payload,
    String(at),
  )
  return payload
}

export interface DerivedBaseline {
  activity: LearningDayActivity[]
  kindStats: Record<string, Record<string, { total: number; correct: number }>>
  at: string | null
}

export function loadDerivedBaseline(db: DatabaseSync): DerivedBaseline {
  const row = db.prepare('SELECT payload, at FROM learning_derived_baseline WHERE id = 1').get()
  if (!row) return { activity: [], kindStats: {}, at: null }
  const parsed = asRecord(parseJson(row.payload))
  return {
    activity: Array.isArray(parsed?.activity) ? (parsed.activity as LearningDayActivity[]) : [],
    kindStats: isRecord(parsed?.kindStats) ? (parsed.kindStats as DerivedBaseline['kindStats']) : {},
    at: String(row.at),
  }
}

/**
 * 重建 kind_stats：baseline + 答题事件。
 *
 * activity_days 是聚合值，而背单词 / 快刷 / 阅读 / 写作 / 跟读只写聚合、不产生
 * answer_events，无法从事件可信重算，所以**原样保留**（只比对，不删）。
 * 不碰 practice / 错题等其它学习记录。返回现有活动聚合，便于测试和排查。
 */
export function rebuildLearningDerived(db: DatabaseSync): LearningDayActivity[] {
  const base = loadDerivedBaseline(db)
  const events = loadLearning(db).answerEvents

  const kindStats = new Map<string, Map<string, { total: number; correct: number }>>()
  const addKind = (articleId: string, kind: string, correct: boolean): void => {
    if (!articleId || !kind) return
    if (!kindStats.has(articleId)) kindStats.set(articleId, new Map())
    const byKind = kindStats.get(articleId)
    const cur = byKind?.get(kind) ?? { total: 0, correct: 0 }
    cur.total += 1
    if (correct) cur.correct += 1
    byKind?.set(kind, cur)
  }
  for (const [articleId, byKind] of Object.entries(base.kindStats)) {
    for (const [kind, stat] of Object.entries(byKind ?? {})) {
      if (!isRecord(stat)) continue
      if (!kindStats.has(articleId)) kindStats.set(articleId, new Map())
      kindStats.get(articleId)?.set(kind, { total: num(stat.total), correct: num(stat.correct) })
    }
  }
  for (const ev of events) {
    if (ev.source === 'quiz') addKind(ev.articleId, ev.kind, ev.correct)
  }

  db.prepare('DELETE FROM kind_stats').run()
  const insertKind = db.prepare(
    'INSERT INTO kind_stats (article_id, kind, total, correct) VALUES (?, ?, ?, ?)',
  )
  for (const [articleId, byKind] of kindStats) {
    for (const [kind, stat] of byKind) insertKind.run(articleId, kind, stat.total, stat.correct)
  }

  return loadLearning(db).activity
}

export function loadLearning(db: DatabaseSync): LearningOut {
  const out = emptyLearning()

  out.practice = db
    .prepare('SELECT at, kind, total, correct, seconds, article_id FROM practice_records ORDER BY at ASC, id ASC')
    .all()
    .map((r): LearningPractice => {
      const rec: LearningPractice = {
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
    .map((r): LearningMistake => {
      const rec: LearningMistake = {
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
    .map((r): LearningReadDone => ({
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
    .map((r): LearningWriting => {
      const rec: LearningWriting = {
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
    .map((r): LearningRetell => ({
      at: String(r.at),
      articleId: String(r.article_id),
      text: String(r.text ?? ''),
      words: Number(r.words),
    }))

  const activity = new Map<string, LearningDayActivity>()
  for (const r of db.prepare('SELECT day, cat, count FROM activity_days ORDER BY day ASC, cat ASC').all()) {
    const day = String(r.day)
    if (!activity.has(day)) activity.set(day, { day, counts: {} })
    activity.get(day)!.counts[String(r.cat)] = Number(r.count)
  }
  out.activity = [...activity.values()]

  out.studyDays = db
    .prepare('SELECT day, seconds, cards FROM study_days ORDER BY day ASC')
    .all()
    .map((r): LearningStudyDay => ({ day: String(r.day), seconds: Number(r.seconds), cards: Number(r.cards) }))

  out.sessions = db
    .prepare('SELECT at, seconds, picked FROM pick_sessions ORDER BY at ASC, id ASC')
    .all()
    .map((r): LearningSession => ({ at: String(r.at), seconds: Number(r.seconds), picked: Number(r.picked) }))

  const studied = new Map<string, LearningStudiedDay>()
  for (const r of db.prepare('SELECT day, word_id FROM study_word_days ORDER BY day ASC, ordinal ASC').all()) {
    const day = String(r.day)
    if (!studied.has(day)) studied.set(day, { day, ids: [] })
    studied.get(day)!.ids.push(String(r.word_id))
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
    out.kindStats[articleId]![String(r.kind)] = {
      total: Number(r.total),
      correct: Number(r.correct),
    }
  }

  out.answerEvents = db
    .prepare(
      'SELECT at, day, article_id, source, kind, cat, correct, question_id FROM answer_events ORDER BY at ASC, id ASC',
    )
    .all()
    .map((r): LearningAnswerEvent => {
      const ev: LearningAnswerEvent = {
        at: String(r.at),
        day: String(r.day ?? ''),
        articleId: String(r.article_id ?? ''),
        source: String(r.source),
        kind: String(r.kind),
        cat: String(r.cat),
        correct: Number(r.correct) !== 0,
      }
      if (r.question_id !== null && r.question_id !== undefined) ev.questionId = String(r.question_id)
      return ev
    })

  return out
}

function asRecord(v: unknown): Record<string, unknown> | null {
  return isRecord(v) ? v : null
}
