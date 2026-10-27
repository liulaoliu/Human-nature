/**
 * 答题事件：每答一题追加一条 append-only 记录。
 *
 * 为什么要有：`activity` / `kindStats` 只有聚合值，算错/丢一条就再也无法对账。
 * 事件表保存原始对错（时间 / 文章 / 题型 / 所属统计分类），
 * 聚合值仍照常写（兼容老数据），事件用于以后重建或核对。
 *
 * 纯函数；存储由 `LearningData.answerEvents`（localStorage → SQLite）负责。
 */
import { ACTIVITY_CATS, addActivity, dayKeyLocal, type ActivityCat, type DayActivity } from './activity'
import type { KindStats } from './learning'
import type { PracticeKind } from './practice'

export interface AnswerEvent {
  /** ISO 时间 */
  at: string
  /** 本地结算日 YYYY-MM-DD（04:00 结算，由 core/activity 统一算） */
  day: string
  /** 来源文章；没有归属时为空串 */
  articleId: string
  /** 哪个会话出的题 */
  source: PracticeKind
  /** 题型：考试是 QuizKind（spell/cloze/…），听写/听力分别是 dictation/listening */
  kind: string
  /** 这条事件计入哪类活动（与当时 recordActivity 的口径一致） */
  cat: ActivityCat
  correct: boolean
  /** 题目 id（重做错题时便于对账；旧数据可缺） */
  questionId?: string
}

/** localStorage 缓存上限：SQLite 才是耐久主存，这里只保证最近一段能离线对账。 */
export const ANSWER_EVENT_CAP = 5000

const SOURCES: ReadonlySet<string> = new Set(['quiz', 'dictation', 'listening', 'golden'])
const CATS: ReadonlySet<string> = new Set(ACTIVITY_CATS)

function isObject(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v)
}

/**
 * 运行时守卫：坏条目丢弃，不因一条脏数据拖垮整份学习记录。
 * localStorage / 导入备份 / `/api/store/learning` 都先过这里。
 */
export function normalizeAnswerEvents(raw: unknown): AnswerEvent[] {
  if (!Array.isArray(raw)) return []
  const out: AnswerEvent[] = []
  for (const row of raw) {
    if (!isObject(row)) continue
    const at = typeof row.at === 'string' ? row.at : ''
    const source = typeof row.source === 'string' ? row.source : ''
    const kind = typeof row.kind === 'string' ? row.kind.trim() : ''
    const cat = typeof row.cat === 'string' ? row.cat : ''
    if (!at || !Number.isFinite(Date.parse(at))) continue
    if (!SOURCES.has(source) || !kind || !CATS.has(cat)) continue
    if (typeof row.correct !== 'boolean') continue
    const ev: AnswerEvent = {
      at,
      day: typeof row.day === 'string' && row.day ? row.day : dayKeyLocal(new Date(at)),
      articleId: typeof row.articleId === 'string' ? row.articleId : '',
      source: source as PracticeKind,
      kind,
      cat: cat as ActivityCat,
      correct: row.correct,
    }
    if (typeof row.questionId === 'string' && row.questionId) ev.questionId = row.questionId
    out.push(ev)
  }
  return out
}

/** 新建事件：没给时间就取当前时刻（测试可传固定时间）。 */
export type AnswerEventInput = Omit<AnswerEvent, 'at' | 'day'> & { at?: string; day?: string }

export function createAnswerEvent(input: AnswerEventInput, now: Date = new Date()): AnswerEvent {
  const at = input.at ?? now.toISOString()
  return { ...input, at, day: input.day ?? dayKeyLocal(new Date(at)) }
}

/** 追加一条（保留最近 cap 条）。纯函数。 */export function addAnswerEvent(
  list: AnswerEvent[],
  event: AnswerEvent,
  cap = ANSWER_EVENT_CAP,
): AnswerEvent[] {
  return [...list, event].slice(-Math.max(0, cap))
}

/**
 * 从事件重建「文章 → 题型」正确率。
 * 只有考试题有题型维度；听写/听力没有 kindStats 口径，跳过。
 */
export function answerEventsToKindStats(events: AnswerEvent[]): KindStats {
  const out: KindStats = {}
  for (const ev of events) {
    if (ev.source !== 'quiz' || !ev.articleId || !ev.kind) continue
    const byKind = (out[ev.articleId] ??= {})
    const cur = (byKind[ev.kind] ??= { total: 0, correct: 0 })
    cur.total += 1
    if (ev.correct) cur.correct += 1
  }
  return out
}

/** 从事件重建活动热力图（按事件里记录的结算日归档）。 */
export function answerEventsToActivity(events: AnswerEvent[]): DayActivity[] {
  let out: DayActivity[] = []
  for (const ev of events) {
    out = addActivity(out, ev.day, ev.cat, 1)
  }
  return out
}
