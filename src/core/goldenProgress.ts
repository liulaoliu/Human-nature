import { dayKeyLocal } from './activity'
import { goldenDrillKey, goldenRecordId, goldenTargetKey, type GoldenTextMeta } from './golden'
import type { GoldenLesson, GoldenSection, GoldenTargetKind, Paragraph } from '../types/document'

/** 一句里要记的步骤；`summary` 只记“看过”，不参与首次对错。 */
export type GoldenStep = 'fill' | 'assemble' | 'recall' | 'summary'

/** 每句的学习进度；按 `id` 去重，存 LearningData.goldenDrills。 */
export interface GoldenDrillRecord {
  /** `${articleId}|${sentenceId}|${drillKey}` */
  id: string
  articleId: string
  articleTitle?: string
  sentenceId: string
  /** 句子文本 + 目标的内容指纹；变了旧进度自然失配 */
  drillKey: string
  at: string
  fillFirst?: boolean
  assembleFirst?: boolean
  recallFirst?: boolean
  fillTries?: number
  assembleTries?: number
  recallTries?: number
  summarySeen?: boolean
  mastered: boolean
  completedAt?: string
}

function isObject(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v)
}

function str(v: unknown): string {
  return typeof v === 'string' ? v.trim() : ''
}

// ── 进度 ────────────────────────────────────────────────────────

export function emptyGoldenRecord(
  articleId: string,
  articleTitle: string | undefined,
  sentenceId: string,
  drillKey: string,
  at: string,
): GoldenDrillRecord {
  return {
    id: goldenRecordId(articleId, sentenceId, drillKey),
    articleId,
    ...(articleTitle ? { articleTitle } : {}),
    sentenceId,
    drillKey,
    at,
    fillTries: 0,
    assembleTries: 0,
    recallTries: 0,
    mastered: false,
  }
}

export function goldenMastered(r: Pick<GoldenDrillRecord, 'fillFirst' | 'assembleFirst' | 'recallFirst' | 'summarySeen'>): boolean {
  return !!r.fillFirst && !!r.assembleFirst && !!r.recallFirst && !!r.summarySeen
}

export function goldenCompleted(r: Pick<GoldenDrillRecord, 'fillTries' | 'assembleTries' | 'recallTries' | 'summarySeen'>): boolean {
  return (r.fillTries ?? 0) > 0 && (r.assembleTries ?? 0) > 0 && (r.recallTries ?? 0) > 0 && !!r.summarySeen
}

/**
 * 「再练一次」：清空本轮首次记录，给用户重新拿掌握的机会。
 * 已掌握 / 完成时间不降级；这是重练唯一的口径。
 */
export function resetGoldenRecord(record: GoldenDrillRecord, at: string): GoldenDrillRecord {
  return {
    ...record,
    fillFirst: undefined,
    assembleFirst: undefined,
    recallFirst: undefined,
    fillTries: 0,
    assembleTries: 0,
    recallTries: 0,
    summarySeen: false,
    mastered: record.mastered,
    completedAt: record.completedAt,
    at,
  }
}

/**
 * 记一步。首次答错后重试不会把 `*First` 改回 true；这是“掌握”口径的底线。
 * 纯函数，调用方只负责把它写进唯一的 goldenDrills。
 */
export function recordGoldenStep(
  record: GoldenDrillRecord,
  step: GoldenStep,
  correct: boolean,
  at: string,
): GoldenDrillRecord {
  const next: GoldenDrillRecord = { ...record, at }
  if (step === 'summary') {
    next.summarySeen = true
  } else {
    const triesKey = `${step}Tries` as 'fillTries' | 'assembleTries' | 'recallTries'
    const firstKey = `${step}First` as 'fillFirst' | 'assembleFirst' | 'recallFirst'
    const tries = (next[triesKey] ?? 0) + 1
    next[triesKey] = tries
    if (tries === 1) next[firstKey] = correct
  }
  // 已掌握是“终身”标记：后再练/重开一轮不会把它降级。
  next.mastered = record.mastered || goldenMastered(next)
  if (next.mastered && !next.completedAt) next.completedAt = at
  return next
}

export function findGoldenRecord(
  records: GoldenDrillRecord[],
  articleId: string,
  sentenceId: string,
  drillKey: string,
): GoldenDrillRecord | null {
  const id = goldenRecordId(articleId, sentenceId, drillKey)
  return records.find((r) => r.id === id) ?? null
}

/**
 * 待回顾口径：已掌握 + 今天还没回顾。
 *
 * 金句本的「待回顾」筛选和课内的回顾队列都走这一条；日期键由调用方传
 * `dayKeyLocal()`，不要在视图/金句本里再写第二套比较。
 */
export function goldenReviewDue(
  record: Pick<GoldenDrillRecord, 'mastered' | 'at'> | null | undefined,
  todayKey: string,
): boolean {
  if (!record?.mastered || !record.at) return false
  const at = Date.parse(record.at)
  if (Number.isNaN(at)) return false
  return dayKeyLocal(new Date(at)) !== todayKey
}

/**
 * 待回顾队列：只保留当前课里、已掌握且今天没回顾的句子，按课文顺序。
 * 计数和真正开队列都用这一份，避免“数字比实际多/少”。
 */
export function goldenReviewSentenceIds(
  records: GoldenDrillRecord[],
  articleId: string,
  sentenceIds: string[],
  todayKey: string,
): string[] {
  const due = new Set(
    records
      .filter((r) => r.articleId === articleId && goldenReviewDue(r, todayKey))
      .map((r) => r.sentenceId),
  )
  return sentenceIds.filter((id) => due.has(id))
}

function numberOrZero(v: unknown): number {
  const n = Number(v)
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0
}

/** 外部输入（localStorage / 备份 / SQLite）→ 好记录；坏条目直接丢。 */
export function normalizeGoldenDrills(raw: unknown): GoldenDrillRecord[] {
  if (!Array.isArray(raw)) return []
  const byId = new Map<string, GoldenDrillRecord>()
  for (const item of raw) {
    if (!isObject(item)) continue
    const articleId = str(item.articleId)
    const sentenceId = str(item.sentenceId)
    const drillKey = str(item.drillKey)
    const at = str(item.at)
    if (!articleId || !sentenceId || !drillKey || !at || Number.isNaN(Date.parse(at))) continue
    const id = str(item.id) || goldenRecordId(articleId, sentenceId, drillKey)
    const rec: GoldenDrillRecord = {
      id,
      articleId,
      ...(str(item.articleTitle) ? { articleTitle: str(item.articleTitle) } : {}),
      sentenceId,
      drillKey,
      at,
      fillTries: numberOrZero(item.fillTries),
      assembleTries: numberOrZero(item.assembleTries),
      recallTries: numberOrZero(item.recallTries),
      ...(item.fillFirst === true ? { fillFirst: true } : {}),
      ...(item.assembleFirst === true ? { assembleFirst: true } : {}),
      ...(item.recallFirst === true ? { recallFirst: true } : {}),
      ...(item.summarySeen === true ? { summarySeen: true } : {}),
      mastered: item.mastered === true,
    }
    if (str(item.completedAt)) rec.completedAt = str(item.completedAt)
    rec.mastered = goldenMastered(rec)
    byId.set(id, rec)
  }
  return [...byId.values()].sort((a, b) => a.at.localeCompare(b.at))
}

/** 合并两份进度：同 id 保留更晚的一条；同一时刻合并首次对错（后者不覆盖已掌握）。 */
export function mergeGoldenDrills(current: GoldenDrillRecord[], incoming: GoldenDrillRecord[]): GoldenDrillRecord[] {
  const byId = new Map(current.map((r) => [r.id, r]))
  for (const rec of incoming) {
    const prev = byId.get(rec.id)
    if (!prev) {
      byId.set(rec.id, rec)
      continue
    }
    const merged: GoldenDrillRecord = {
      ...(rec.at >= prev.at ? rec : prev),
      fillTries: Math.max(prev.fillTries ?? 0, rec.fillTries ?? 0),
      assembleTries: Math.max(prev.assembleTries ?? 0, rec.assembleTries ?? 0),
      recallTries: Math.max(prev.recallTries ?? 0, rec.recallTries ?? 0),
      ...(prev.fillFirst || rec.fillFirst ? { fillFirst: true } : {}),
      ...(prev.assembleFirst || rec.assembleFirst ? { assembleFirst: true } : {}),
      ...(prev.recallFirst || rec.recallFirst ? { recallFirst: true } : {}),
      ...(prev.summarySeen || rec.summarySeen ? { summarySeen: true } : {}),
    }
    merged.mastered = goldenMastered(merged)
    if (merged.mastered) merged.completedAt = prev.completedAt || rec.completedAt || merged.at
    byId.set(rec.id, merged)
  }
  return [...byId.values()].sort((a, b) => a.at.localeCompare(b.at))
}

export interface GoldenMasterySummary {
  selectedSentences: number
  masteredSentences: number
  totalTargets: number
  masteredTargets: number
  byKind: { kind: GoldenTargetKind; total: number; mastered: number }[]
  bySection: { paraId: string; role: GoldenSection['role']; total: number; mastered: number }[]
}

/**
 * 统计“学习句子 / 学习点 / 掌握”的展示口径。
 * 默认按句独立（同一目标在多句各算一次）；`options.dedupe` 打开时才跨句去重。
 */
export function summarizeGolden(
  lesson: GoldenLesson,
  sentences: GoldenTextMeta[],
  records: GoldenDrillRecord[],
  articleId: string,
  paragraphs?: Paragraph[],
): GoldenMasterySummary {
  const textOf = new Map(sentences.map((s) => [s.id, s.text]))
  const paraOf = new Map<string, string>()
  for (const p of paragraphs ?? []) for (const id of p.sentenceIds) paraOf.set(id, p.id)
  const dedupe = lesson.options?.dedupe === true
  const selected = new Set(lesson.selected.length ? lesson.selected : lesson.sentences.map((s) => s.id))
  const content = new Map(lesson.sentences.map((s) => [s.id, s]))
  const progress = new Map(
    records.filter((r) => r.articleId === articleId).map((r) => [`${r.sentenceId}|${r.drillKey}`, r]),
  )
  const seen = new Set<string>()
  const byKind = new Map<GoldenTargetKind, { total: number; mastered: number }>()
  const bySection = new Map<string, { paraId: string; role: GoldenSection['role']; total: number; mastered: number }>()
  let totalTargets = 0
  let masteredTargets = 0
  let masteredSentences = 0
  let selectedSentences = 0
  for (const id of selected) {
    const s = content.get(id)
    if (!s) continue
    const text = textOf.get(s.id) ?? ''
    const rec = progress.get(`${s.id}|${goldenDrillKey(text, s.targets)}`)
    const mastered = rec?.mastered === true
    selectedSentences += 1
    if (mastered) masteredSentences += 1
    let total = 0
    for (const t of s.targets) {
      const key = goldenTargetKey(t)
      if (dedupe && seen.has(key)) continue
      seen.add(key)
      total += 1
      const cur = byKind.get(t.kind) ?? { total: 0, mastered: 0 }
      cur.total += 1
      if (mastered) cur.mastered += 1
      byKind.set(t.kind, cur)
    }
    totalTargets += total
    if (mastered) masteredTargets += total
    const paraId = paraOf.get(s.id)
    const sec = paraId ? lesson.outline.find((x) => x.paraId === paraId) : undefined
    if (sec) {
      const row = bySection.get(sec.paraId) ?? { paraId: sec.paraId, role: sec.role, total: 0, mastered: 0 }
      row.total += total
      if (mastered) row.mastered += total
      bySection.set(sec.paraId, row)
    }
  }
  return {
    selectedSentences,
    masteredSentences,
    totalTargets,
    masteredTargets,
    byKind: [...byKind.entries()].map(([kind, v]) => ({ kind, ...v })),
    bySection: [...bySection.values()],
  }
}
