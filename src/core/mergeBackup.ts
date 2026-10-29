/**
 * 备份「合并导入」：把一份备份里的内容并进现有数据，而不是整片覆盖。
 *
 * 覆盖式导入（`reader/hooks/backupIO.ts` 的 `onImportBackup`）语义是「还原」——
 * 词库整库替换、统计整段替换。合并导入面向「另一台机器的数据想并过来」：
 *   - 词库：按 lemma 去重互补（不丢字段、不丢词）
 *   - 文章：按 id upsert（在 backupIO 里做，本来就不会清空别的文章）
 *   - 统计：会话 / 练习 / 仿写按记录去重后拼接；背单词与活动按「天」累加；
 *     错题按 id 累加次数（同一份备份再导一次不会重复计数）
 *
 * 全是纯函数，落 core/，方便单测。
 */
import type { VocabLibrary } from '../types/document'
import { dedupeLibrary } from './vocab'
import { mergeArticleEntries } from './articleVocab'
import { applyTombstones, mergeTombstones } from './vocab/tombstones'
import type { PickSession, StudyDay } from './vocabStats'
import { ACTIVITY_CATS, addActivity, type DayActivity } from './activity'
import type { WritingRecord } from './writing'
import type { BackTranslationRecord } from './backTranslate'
import type { PracticeRecord } from './practice'
import type { MistakeEntry } from './mistakes'
import type { KindStats, RetellRecord, StudiedDay } from './learning'
import type { AnswerEvent } from './answerEvents'

export { mergeGoldenDrills } from './goldenProgress'

/**
 * 句子原文共享表：同键不同文时**本机优先**。
 *
 * 键是 `articleId\0sentenceId`，两台机器上的同名文章可能已经被改过（换过句子、删过段），
 * 同一个键会指向不同原文。这里不能整表覆盖：覆盖了，本机那些引用该键的词条
 * （`source` / `contexts` 的原文已收进共享表、自身是空串）会突然显示另一台机器的句子。
 * 合并导入的承诺是「不覆盖本机」，所以旧值留着，新键照常补进来。
 */
function mergeSentenceTexts(
  current: VocabLibrary['sentenceTexts'],
  incoming: VocabLibrary['sentenceTexts'],
): VocabLibrary['sentenceTexts'] {
  if (!incoming || !Object.keys(incoming).length) return current
  if (!current || !Object.keys(current).length) return incoming
  return { ...incoming, ...current }
}

/** 合并两套词库：按 lemma 去重互补，保留任一方已有的字段；按篇条目取并集。 */
export function mergeLibraries(current: VocabLibrary, incoming: VocabLibrary): VocabLibrary {
  const sentenceTexts = mergeSentenceTexts(current.sentenceTexts, incoming.sentenceTexts) ?? {}
  const tombstones = mergeTombstones(current.tombstones, incoming.tombstones)
  return applyTombstones(
    dedupeLibrary({
      schemaVersion: current.schemaVersion,
      items: [...current.items, ...incoming.items],
      articleEntries: mergeArticleEntries(current.articleEntries ?? [], incoming.articleEntries ?? []),
      ...(Object.keys(sentenceTexts).length ? { sentenceTexts } : {}),
      ...(tombstones.length ? { tombstones } : {}),
    }),
  )
}

const SESSION_CAP = 500

/** 合并选词会话：同一条记录去重，按时间升序，保留最近 cap 条。 */
export function mergeSessions(current: PickSession[], incoming: PickSession[], cap = SESSION_CAP): PickSession[] {
  const key = (s: PickSession) => `${s.at}|${s.seconds}|${s.picked}`
  const seen = new Set(current.map(key))
  const out = [...current]
  for (const s of incoming) {
    const k = key(s)
    if (seen.has(k)) continue
    seen.add(k)
    out.push(s)
  }
  out.sort((a, b) => a.at.localeCompare(b.at))
  return out.slice(-Math.max(0, cap))
}

/** 合并背单词按天累计：同一天的秒数与卡数相加。 */
export function mergeStudyDays(current: StudyDay[], incoming: StudyDay[]): StudyDay[] {
  const byDay = new Map<string, StudyDay>()
  for (const d of current) byDay.set(d.day, { ...d })
  for (const d of incoming) {
    const prev = byDay.get(d.day)
    byDay.set(
      d.day,
      prev ? { day: d.day, seconds: prev.seconds + d.seconds, cards: prev.cards + d.cards } : { ...d },
    )
  }
  return [...byDay.values()].sort((a, b) => a.day.localeCompare(b.day))
}

/** 合并活动热力图数据：同一天同类相加（复用 addActivity 的排序与上限）。 */
export function mergeActivity(current: DayActivity[], incoming: DayActivity[], cap = 400): DayActivity[] {
  let out = current
  for (const day of incoming) {
    for (const cat of ACTIVITY_CATS) {
      const n = day.counts[cat] ?? 0
      if (n > 0) out = addActivity(out, day.day, cat, n, cap)
    }
  }
  return out
}

const WRITING_CAP = 200

/** 合并仿写记录：按「时间 + 文章 + 范句 + 作答」去重，按时间倒序，保留最近 cap 条。 */
export function mergeWritingHistory(
  current: WritingRecord[],
  incoming: WritingRecord[],
  cap = WRITING_CAP,
): WritingRecord[] {
  const key = (w: WritingRecord) => `${w.at}|${w.articleId}|${w.model}|${w.text}`
  const seen = new Set(current.map(key))
  const out = [...current]
  for (const w of incoming) {
    const k = key(w)
    if (seen.has(k)) continue
    seen.add(k)
    out.push(w)
  }
  out.sort((a, b) => b.at.localeCompare(a.at))
  return out.slice(0, Math.max(0, cap))
}

/**
 * 合并回译存档：按 id 去重后拼接，按时间倒序。
 * 这是长期资产，不设「只留最近 N 条」的上限；同一份备份重复导入也不会重复。
 */
export function mergeBackTranslations(
  current: BackTranslationRecord[],
  incoming: BackTranslationRecord[],
): BackTranslationRecord[] {
  const byId = new Map<string, BackTranslationRecord>()
  for (const r of [...current, ...incoming]) byId.set(r.id, r)
  return [...byId.values()].sort((a, b) => b.at.localeCompare(a.at))
}

const PRACTICE_CAP = 500

/** 合并练习记录：按字段去重，按时间升序，保留最近 cap 条。 */
export function mergePractice(
  current: PracticeRecord[],
  incoming: PracticeRecord[],
  cap = PRACTICE_CAP,
): PracticeRecord[] {
  const key = (p: PracticeRecord) =>
    `${p.at}|${p.kind}|${p.total}|${p.correct}|${p.seconds ?? ''}|${p.articleId ?? ''}`
  const seen = new Set(current.map(key))
  const out = [...current]
  for (const p of incoming) {
    const k = key(p)
    if (seen.has(k)) continue
    seen.add(k)
    out.push(p)
  }
  out.sort((a, b) => a.at.localeCompare(b.at))
  return out.slice(-Math.max(0, cap))
}

/** 合并答题事件：按「时间 + 文章 + 题型 + 题目」去重，按时间升序，保留最近 cap 条。 */
export function mergeAnswerEvents(
  current: AnswerEvent[],
  incoming: AnswerEvent[],
  cap = 5000,
): AnswerEvent[] {
  const key = (e: AnswerEvent) =>
    `${e.at}|${e.articleId}|${e.source}|${e.kind}|${e.correct ? 1 : 0}|${e.questionId ?? ''}`
  const seen = new Set(current.map(key))
  const out = [...current]
  for (const e of incoming) {
    const k = key(e)
    if (seen.has(k)) continue
    seen.add(k)
    out.push(e)
  }
  out.sort((a, b) => a.at.localeCompare(b.at))
  return out.slice(-Math.max(0, cap))
}

const MISTAKE_CAP = 300
/** 合并错题本：同 id 累加次数、保留更近的一条；完全相同的一份记录不重复计数。 */
export function mergeMistakes(
  current: MistakeEntry[],
  incoming: MistakeEntry[],
  cap = MISTAKE_CAP,
): MistakeEntry[] {
  const byId = new Map<string, MistakeEntry>()
  for (const m of current) byId.set(m.id, { ...m })
  for (const m of incoming) {
    const prev = byId.get(m.id)
    if (!prev) {
      byId.set(m.id, { ...m })
      continue
    }
    // 同一份备份再导一次：字段完全一致，视作重复，不累加
    if (prev.at === m.at && prev.count === m.count) continue
    const newer = prev.at >= m.at ? prev : m
    byId.set(m.id, { ...newer, count: (prev.count ?? 0) + (m.count ?? 0) })
  }
  return [...byId.values()].sort((a, b) => b.at.localeCompare(a.at)).slice(0, Math.max(0, cap))
}

const RETELL_CAP = 200

/** 合并复述：按「时间 + 文章 + 正文」去重，按时间倒序，保留最近 cap 条。 */
export function mergeRetells(
  current: RetellRecord[],
  incoming: RetellRecord[],
  cap = RETELL_CAP,
): RetellRecord[] {
  const key = (r: RetellRecord) => `${r.at}|${r.articleId}|${r.text}`
  const seen = new Set(current.map(key))
  const out = [...current]
  for (const r of incoming) {
    const k = key(r)
    if (seen.has(k)) continue
    seen.add(k)
    out.push(r)
  }
  out.sort((a, b) => b.at.localeCompare(a.at))
  return out.slice(0, Math.max(0, cap))
}

/** 合并「每天背过哪些词」：同一天取 id 并集，不重复计数。 */
export function mergeStudiedDays(current: StudiedDay[], incoming: StudiedDay[]): StudiedDay[] {
  const byDay = new Map<string, Set<string>>()
  for (const d of [...current, ...incoming]) {
    const ids = byDay.get(d.day) ?? new Set<string>()
    for (const id of d.ids) ids.add(id)
    byDay.set(d.day, ids)
  }
  return [...byDay.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([day, ids]) => ({ day, ids: [...ids] }))
}

/** 合并精读「略读」标记：按文章 id 取并集。 */
export function mergeSkimmed(current: string[], incoming: string[]): string[] {
  return [...new Set([...current, ...incoming])]
}

/**
 * 合并按篇/题型正确率。
 *
 * 这份数据只有 total/correct，没有时间戳或事件 id，无法判断两份是不是同一批答题；
 * 因此取「题数更多的那个口径」，保证同一份备份重复导入不会把正确率翻倍。
 */
export function mergeKindStats(current: KindStats, incoming: KindStats): KindStats {
  const out: KindStats = {}
  for (const [articleId, kinds] of Object.entries(current)) {
    out[articleId] = { ...kinds }
  }
  for (const [articleId, kinds] of Object.entries(incoming)) {
    const target = (out[articleId] ??= {})
    for (const [kind, stat] of Object.entries(kinds)) {
      const prev = target[kind]
      if (!prev || stat.total > prev.total || (stat.total === prev.total && stat.correct > prev.correct)) {
        target[kind] = { ...stat }
      }
    }
  }
  return out
}
