import { dayKeyLocal, dayTotal, type ActivityCat, type DayActivity } from './activity'
import { getSentenceLanguages } from './language'
import type { SentenceLanguage, VocabItem } from '../types/document'

/**
 * 学习日志：按「天」回顾 —— 那天学了哪些词、新增了哪些生词 / 语言点、
 * 当天活动量与练习成绩。纯函数，方便单测。
 */

export interface JournalArticle {
  id: string
  title: string
  sentences: { id: string; text: string; language?: SentenceLanguage; languages?: SentenceLanguage[] }[]
}

export interface JournalInput {
  /** 每天背过的词 id（`reader:studiedToday`，按天累积） */
  studied: { day: string; ids: string[] }[]
  /** 词库（含 createdAt / updatedAt） */
  items: VocabItem[]
  /** 已保存文章（用来扫语言点的时间戳） */
  articles: JournalArticle[]
  /** 每天的学习活动计数 */
  activity: DayActivity[]
  /** 练习成绩（考试/听写/听力） */
  practice: { at: string; kind: string; total: number; correct: number }[]
}

export interface JournalLanguage {
  articleId: string
  articleTitle: string
  sentenceId: string
  sentence: string
  /** 添加/生成时刻（ISO） */
  at: string
  /** 手动添加 / AI 生成 */
  manual: boolean
  structure?: string
  grammar?: string
  idioms?: string[]
  phrases?: string[]
  usage?: string[]
}

export interface JournalDay {
  day: string
  /** 当天背过的词（按背的顺序去重） */
  studied: VocabItem[]
  /** 当天新增的生词（createdAt 落在当天） */
  addedWords: VocabItem[]
  /** 当天新增/生成的句子语言点 */
  addedLanguages: JournalLanguage[]
  /** 当天学习活动计数（读/词/听/写） */
  activity: Partial<Record<ActivityCat, number>>
  /** 当天练习成绩（按类型合计） */
  practice: { kind: string; total: number; correct: number }[]
}

const dayOf = (iso: string | undefined | null): string => {
  if (!iso) return ''
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '' : dayKeyLocal(d)
}

/** 有记录的日期（倒序，去重）。 */
export function journalDays(i: JournalInput): string[] {
  const set = new Set<string>()
  for (const s of i.studied) if (s.ids.length) set.add(s.day)
  for (const a of i.activity) if (dayTotal(a) > 0) set.add(a.day)
  for (const p of i.practice) {
    const d = dayOf(p.at)
    if (d) set.add(d)
  }
  for (const it of i.items) {
    const d = dayOf(it.createdAt)
    if (d) set.add(d)
  }
  for (const a of i.articles) {
    for (const s of a.sentences) {
      for (const L of getSentenceLanguages(s)) {
        const d = dayOf(L.at)
        if (d) set.add(d)
      }
    }
  }
  return [...set].sort((a, b) => b.localeCompare(a))
}

export interface JournalSummaryRow {
  day: string
  /** 当天新增生词数 */
  addedWords: number
  /** 当天背过的词数 */
  studied: number
  /** 当天新增语言点数 */
  languages: number
  /** 当天活动总量 */
  activity: number
}

/**
 * 每天一行的小结（给日志的日期列表用）。一趟扫完，按日期倒序。
 */
export function journalSummary(i: JournalInput): JournalSummaryRow[] {
  const m = new Map<string, JournalSummaryRow>()
  const row = (day: string): JournalSummaryRow => {
    let r = m.get(day)
    if (!r) {
      r = { day, addedWords: 0, studied: 0, languages: 0, activity: 0 }
      m.set(day, r)
    }
    return r
  }
  for (const it of i.items) {
    const d = dayOf(it.createdAt)
    if (d) row(d).addedWords += 1
  }
  for (const s of i.studied) {
    if (s.ids.length) row(s.day).studied += new Set(s.ids).size
  }
  for (const a of i.activity) {
    const n = dayTotal(a)
    if (n > 0) row(a.day).activity += n
  }
  for (const a of i.articles) {
    for (const s of a.sentences) {
      for (const L of getSentenceLanguages(s)) {
        const d = dayOf(L.at)
        if (d) row(d).languages += 1
      }
    }
  }
  return [...m.values()].sort((a, b) => b.day.localeCompare(a.day))
}

/** 某一天的明细。 */
export function buildJournalDay(i: JournalInput, day: string): JournalDay {
  const byId = new Map(i.items.map((it) => [it.id, it]))

  // 当天背过的词（按记录顺序，去重）
  const studied: VocabItem[] = []
  const seen = new Set<string>()
  for (const s of i.studied) {
    if (s.day !== day) continue
    for (const id of s.ids) {
      if (seen.has(id)) continue
      seen.add(id)
      const it = byId.get(id)
      if (it) studied.push(it)
    }
  }

  const addedWords = i.items.filter((it) => dayOf(it.createdAt) === day)

  const addedLanguages: JournalLanguage[] = []
  for (const a of i.articles) {
    for (const s of a.sentences) {
      for (const L of getSentenceLanguages(s)) {
        if (dayOf(L.at) !== day) continue
        addedLanguages.push({
          articleId: a.id,
          articleTitle: a.title,
          sentenceId: s.id,
          sentence: s.text,
          at: L.at as string,
          manual: L.source === 'manual',
          structure: L.structure,
          grammar: L.grammar,
          idioms: L.idioms,
          phrases: L.phrases,
          usage: L.usage,
        })
      }
    }
  }
  addedLanguages.sort((a, b) => a.at.localeCompare(b.at))

  const act = i.activity.find((a) => a.day === day)
  const practice = new Map<string, { total: number; correct: number }>()
  for (const p of i.practice) {
    if (dayOf(p.at) !== day) continue
    const cur = practice.get(p.kind) ?? { total: 0, correct: 0 }
    cur.total += p.total
    cur.correct += p.correct
    practice.set(p.kind, cur)
  }

  return {
    day,
    studied,
    addedWords,
    addedLanguages,
    activity: act ? { ...act.counts } : {},
    practice: [...practice].map(([kind, v]) => ({ kind, ...v })),
  }
}
