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
  backTranslations: LearningBackTranslation[]
  retells: LearningRetell[]
  activity: LearningDayActivity[]
  studyDays: LearningStudyDay[]
  sessions: LearningSession[]
  studiedDays: LearningStudiedDay[]
  skimmed: string[]
  kindStats: Record<string, Record<string, { total: number; correct: number }>>
  answerEvents: LearningAnswerEvent[]
  goldenDrills: LearningGoldenDrill[]
  writingErrorProgress: LearningWritingErrorProgress[]
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
  /** 普通仿写 / 金句课单句 / 金句课考试；老记录没有 = 普通仿写 */
  source?: string
  sentenceId?: string
  examId?: string
}

export interface LearningRetell {
  at: string
  articleId: string
  text: string
  words: number
}

export interface LearningBackTranslation {
  id: string
  at: string
  articleId: string
  articleTitle?: string
  sentenceId: string
  sourceZh: string
  contextZh?: string
  answer: string
  reference: string
  feedback: unknown
  closeness: { exact: boolean; ratio: number }
  gradedBy?: string
}export interface LearningDayActivity {
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

export interface LearningGoldenDrill {
  id: string
  at: string
  articleId: string
  articleTitle?: string
  sentenceId: string
  drillKey: string
  fillFirst?: boolean
  assembleFirst?: boolean
  recallFirst?: boolean
  fillTries: number
  assembleTries: number
  recallTries: number
  summarySeen?: boolean
  mastered: boolean
  completedAt?: string
}

export interface LearningWritingErrorProgress {
  id: string
  rule: string
  key: string
  articleId: string
  sentenceId?: string
  examId?: string
  focus?: string
  original: string
  suggestion: string
  reason?: string
  status: string
  streak: number
  reviews: number
  lastAt?: string
  lastCorrect?: boolean
  dueAt?: string
  createdAt: string
  updatedAt: string
}

export function emptyLearning(): LearningOut {
  return {
    practice: [],
    mistakes: [],
    readDone: [],
    writingHistory: [],
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
    'backTranslations',
    'retells',
    'activity',
    'studyDays',
    'sessions',
    'studiedDays',
    'skimmed',
    'answerEvents',
    'goldenDrills',
    'writingErrorProgress',
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

/**
 * 学习记录 → 独立表。
 * 默认整份替换；传 `only` 时只替换指定 section，避免改一条练习就重写整份记录。
 * 直接写规范化表；回滚粒度是 `data/backups/` 的每日整库备份。
 */
export function writeLearning(db: DatabaseSync, data: unknown, only?: string[]): void {
  assertLearning(data)
  const sections = only ? [...new Set(only)] : [...LEARNING_SECTIONS]
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
      'SELECT at, article_id, article_title, model, text, feedback_json, task_json, source, sentence_id, exam_id FROM writing_records ORDER BY at DESC, id DESC',
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
      // 来源只认白名单：坏值当普通仿写，别让金句课历史被一条脏数据带歪
      if (r.source === 'writing' || r.source === 'goldenSentence' || r.source === 'goldenExam') {
        rec.source = r.source
      }
      if (r.sentence_id !== null && r.sentence_id !== undefined) rec.sentenceId = String(r.sentence_id)
      if (r.exam_id !== null && r.exam_id !== undefined) rec.examId = String(r.exam_id)
      return rec
    })

  out.backTranslations = db
    .prepare(
      'SELECT id, at, article_id, article_title, sentence_id, source_zh, context_zh, answer, reference, feedback_json, exact, ratio, graded_by FROM back_translation_records ORDER BY at DESC, id DESC',
    )
    .all()
    .map((r): LearningBackTranslation => {
      const rec: LearningBackTranslation = {
        id: String(r.id),
        at: String(r.at),
        articleId: String(r.article_id ?? ''),
        sentenceId: String(r.sentence_id ?? ''),
        sourceZh: String(r.source_zh ?? ''),
        answer: String(r.answer ?? ''),
        reference: String(r.reference ?? ''),
        feedback: parseJson(r.feedback_json) ?? {},
        closeness: { exact: Number(r.exact) === 1, ratio: Number(r.ratio) || 0 },
      }
      if (r.article_title !== null) rec.articleTitle = String(r.article_title)
      if (r.context_zh !== null) rec.contextZh = String(r.context_zh)
      if (r.graded_by !== null) rec.gradedBy = String(r.graded_by)
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

  out.goldenDrills = db
    .prepare(
      'SELECT id, at, article_id, article_title, sentence_id, drill_key, fill_first, assemble_first, recall_first, fill_tries, assemble_tries, recall_tries, summary_seen, mastered, completed_at FROM golden_drill_records ORDER BY at ASC, id ASC',
    )
    .all()
    .map((r): LearningGoldenDrill => {
      const rec: LearningGoldenDrill = {
        id: String(r.id),
        at: String(r.at),
        articleId: String(r.article_id ?? ''),
        sentenceId: String(r.sentence_id ?? ''),
        drillKey: String(r.drill_key ?? ''),
        fillTries: Number(r.fill_tries) || 0,
        assembleTries: Number(r.assemble_tries) || 0,
        recallTries: Number(r.recall_tries) || 0,
        mastered: Number(r.mastered) !== 0,
      }
      if (r.article_title !== null && r.article_title !== undefined) rec.articleTitle = String(r.article_title)
      if (Number(r.fill_first) !== 0) rec.fillFirst = true
      if (Number(r.assemble_first) !== 0) rec.assembleFirst = true
      if (Number(r.recall_first) !== 0) rec.recallFirst = true
      if (Number(r.summary_seen) !== 0) rec.summarySeen = true
      if (r.completed_at !== null && r.completed_at !== undefined) rec.completedAt = String(r.completed_at)
      return rec
    })

  out.writingErrorProgress = db
    .prepare(
      'SELECT id, rule, key, article_id, sentence_id, exam_id, focus, original, suggestion, reason, status, streak, reviews, last_at, last_correct, due_at, created_at, updated_at FROM writing_error_progress ORDER BY updated_at DESC, id ASC',
    )
    .all()
    .map((r): LearningWritingErrorProgress => {
      const row: LearningWritingErrorProgress = {
        id: String(r.id),
        rule: String(r.rule ?? ''),
        key: String(r.key ?? ''),
        articleId: String(r.article_id ?? ''),
        original: String(r.original ?? ''),
        suggestion: String(r.suggestion ?? ''),
        status: String(r.status ?? 'active'),
        streak: Number(r.streak) || 0,
        reviews: Number(r.reviews) || 0,
        createdAt: String(r.created_at ?? ''),
        updatedAt: String(r.updated_at ?? ''),
      }
      if (r.sentence_id !== null && r.sentence_id !== undefined) row.sentenceId = String(r.sentence_id)
      if (r.exam_id !== null && r.exam_id !== undefined) row.examId = String(r.exam_id)
      if (r.focus !== null && r.focus !== undefined) row.focus = String(r.focus)
      if (r.reason !== null && r.reason !== undefined) row.reason = String(r.reason)
      if (r.last_at !== null && r.last_at !== undefined) row.lastAt = String(r.last_at)
      if (r.last_correct !== null && r.last_correct !== undefined) row.lastCorrect = Number(r.last_correct) !== 0
      if (r.due_at !== null && r.due_at !== undefined) row.dueAt = String(r.due_at)
      return row
    })

  return out
}

function asRecord(v: unknown): Record<string, unknown> | null {
  return isRecord(v) ? v : null
}
