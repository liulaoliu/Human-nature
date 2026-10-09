/**
 * 备份「合并导入」：把一份备份里的内容并进现有数据，而不是整片覆盖。
 *
 * 覆盖式导入（`reader/hooks/useExport.ts` 的 `onImportBackup`）语义是「还原」——
 * 词库整库替换、统计整段替换。合并导入面向「另一台机器的数据想并过来」：
 *   - 词库：按 lemma 去重互补（不丢字段、不丢词）
 *   - 文章：按 id upsert（在 useExport 里做，本来就不会清空别的文章）
 *   - 统计：会话 / 练习 / 仿写按记录去重后拼接；背单词与活动按「天」累加；
 *     错题按 id 累加次数（同一份备份再导一次不会重复计数）
 *
 * 全是纯函数，落 core/，方便单测。
 */
import type { VocabLibrary } from '../types/document'
import { dedupeLibrary } from './vocab'
import type { PickSession, StudyDay } from './vocabStats'
import { ACTIVITY_CATS, addActivity, type DayActivity } from './activity'
import type { WritingRecord } from './writing'
import type { PracticeRecord } from './practice'
import type { MistakeEntry } from './mistakes'

/** 合并两套词库：按 lemma 去重互补，保留任一方已有的字段。 */
export function mergeLibraries(current: VocabLibrary, incoming: VocabLibrary): VocabLibrary {
  return dedupeLibrary({
    schemaVersion: current.schemaVersion,
    items: [...current.items, ...incoming.items],
  })
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
