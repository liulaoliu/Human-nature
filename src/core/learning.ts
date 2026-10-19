/**
 * 学习记录（durable learning data）。
 *
 * 这里只放**用户学习记录**：练习成绩、错题、读完/精读进度、写作、复述、活动统计、
 * 背词/选词记录。它们不是“偏好”：换浏览器、清 localStorage 后应该还能恢复。
 *
 * 偏好 / 会话状态（主题、字号、面板开关、上次文章、草稿、会话快照）**不要**放进来；
 * 那些继续留在 localStorage（Android 的 SharedPreferences / DataStore 类比）。
 *
 * 存储实现见 `adapters/learningRepo.ts`：SQLite 优先，localStorage 作为同步缓存。
 */

import type { DayActivity } from './activity'
import type { ReadDone } from './goals'
import type { MistakeEntry } from './mistakes'
import type { PracticeRecord } from './practice'
import type { PickSession, StudyDay } from './vocabStats'
import type { WritingRecord } from './writing'

/** 复述打卡：用自己的话复述的留档（按篇）。 */
export interface RetellRecord {
  at: string
  articleId: string
  text: string
  words: number
}

/** 每天背过的词 id（`reader:studiedToday`，按天累积）。 */
export interface StudiedDay {
  day: string
  ids: string[]
}

/** 按「文章 → 题型」统计的练习正确率（词块/搭配量化用）。 */
export type KindStats = Record<string, Record<string, { total: number; correct: number }>>

/**
 * 一份完整的学习记录。
 *
 * 字段名尽量沿用 localStorage 键的语义，迁移时不用再做一层翻译。
 */
export interface LearningData {
  practice: PracticeRecord[]
  mistakes: MistakeEntry[]
  readDone: ReadDone[]
  writingHistory: WritingRecord[]
  retells: RetellRecord[]
  activity: DayActivity[]
  studyDays: StudyDay[]
  sessions: PickSession[]
  studiedDays: StudiedDay[]
  skimmed: string[]
  kindStats: KindStats
}

/** 学习记录里可以单独增量同步的部分。 */
export type LearningSection = keyof LearningData

export const LEARNING_SECTIONS: LearningSection[] = [
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
  'kindStats',
]

/** 空记录。每次都返回新数组/新对象，避免调用方改到共享常量。 */
export function emptyLearning(): LearningData {
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

function asArray<T>(v: unknown): T[] {
  return Array.isArray(v) ? (v as T[]) : []
}

function isObject(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v)
}

/** 宽容解析：坏字段丢掉，别让一条脏数据拖垮整份学习记录。 */
export function normalizeLearning(raw: unknown): LearningData {
  const out = emptyLearning()
  if (!isObject(raw)) return out
  out.practice = asArray<PracticeRecord>(raw.practice).filter(
    (r) =>
      isObject(r) &&
      typeof r.at === 'string' &&
      typeof r.kind === 'string' &&
      Number.isFinite(Number(r.total)) &&
      Number.isFinite(Number(r.correct)),
  )
  out.mistakes = asArray<MistakeEntry>(raw.mistakes).filter(
    (r) =>
      isObject(r) &&
      typeof r.id === 'string' &&
      typeof r.kind === 'string' &&
      typeof r.at === 'string' &&
      typeof r.label === 'string' &&
      Number.isFinite(Number(r.count)),
  )
  out.readDone = asArray<ReadDone>(raw.readDone).filter(
    (r) => isObject(r) && typeof r.articleId === 'string' && typeof r.day === 'string' && typeof r.at === 'string',
  )
  out.writingHistory = asArray<WritingRecord>(raw.writingHistory).filter(
    (r) => isObject(r) && typeof r.at === 'string' && typeof r.text === 'string',
  )
  out.retells = asArray<RetellRecord>(raw.retells).filter(
    (r) =>
      isObject(r) &&
      typeof r.at === 'string' &&
      typeof r.articleId === 'string' &&
      typeof r.text === 'string' &&
      Number.isFinite(Number(r.words)),
  )
  out.activity = asArray<DayActivity>(raw.activity)
    .filter((r) => isObject(r) && typeof r.day === 'string' && isObject(r.counts))
    .map((r) => {
      const counts: Record<string, number> = {}
      for (const [cat, n] of Object.entries(r.counts)) {
        const v = Number(n)
        if (Number.isFinite(v) && v > 0) counts[cat] = v
      }
      return { day: r.day, counts }
    })
  out.studyDays = asArray<StudyDay>(raw.studyDays).filter(
    (r) =>
      isObject(r) &&
      typeof r.day === 'string' &&
      Number.isFinite(Number(r.seconds)) &&
      Number.isFinite(Number(r.cards)),
  )
  out.sessions = asArray<PickSession>(raw.sessions).filter(
    (r) =>
      isObject(r) &&
      typeof r.at === 'string' &&
      Number.isFinite(Number(r.seconds)) &&
      Number.isFinite(Number(r.picked)),
  )
  out.studiedDays = asArray<StudiedDay>(raw.studiedDays)
    .filter((r) => isObject(r) && typeof r.day === 'string')
    .map((r) => ({ day: r.day, ids: asArray<string>(r.ids).filter((id) => typeof id === 'string') }))
  out.skimmed = asArray<string>(raw.skimmed).filter((id) => typeof id === 'string' && id.length > 0)
  out.kindStats = {}
  if (isObject(raw.kindStats)) {
    for (const [articleId, byKind] of Object.entries(raw.kindStats)) {
      if (!isObject(byKind)) continue
      const row: Record<string, { total: number; correct: number }> = {}
      for (const [kind, stat] of Object.entries(byKind)) {
        if (!isObject(stat)) continue
        const total = Number(stat.total)
        const correct = Number(stat.correct)
        if (!Number.isFinite(total) || !Number.isFinite(correct)) continue
        row[kind] = { total, correct }
      }
      if (Object.keys(row).length) out.kindStats[articleId] = row
    }
  }
  return out
}

/** 是否至少有一条学习记录（偏好不算）。 */
export function hasLearningData(data: LearningData): boolean {
  return (
    data.practice.length > 0 ||
    data.mistakes.length > 0 ||
    data.readDone.length > 0 ||
    data.writingHistory.length > 0 ||
    data.retells.length > 0 ||
    data.activity.length > 0 ||
    data.studyDays.length > 0 ||
    data.sessions.length > 0 ||
    data.studiedDays.some((d) => d.ids.length > 0) ||
    data.skimmed.length > 0 ||
    Object.keys(data.kindStats).length > 0
  )
}
