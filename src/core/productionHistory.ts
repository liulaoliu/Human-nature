import { dayKeyLocal } from './activity'
import type {
  ProductionMode,
  ProductionTarget,
  ProductionTargetHit,
  ProductionTargetKind,
} from './production'
import {
  isProductionTask,
  productionHits,
  skippedProductionFeedback,
  type ProductionTask,
} from './productionPrompts'
import type { WritingRecord } from './writing'
import { writingRecordKey } from './writing'

/**
 * 奶牛工棚的派生视图：尝试记录仍写 `writing_records`（`source='production'`），
 * 目标块进度、统计、历史筛选都从这里**现算**。
 *
 * 为什么不另存一张 production_progress：attempts 是 append-only 的事实，
 * 进度只是它的函数；单写一份会多一个需要迁移、对账、备份的状态源。
 */

export interface ProductionProgress {
  key: string
  itemId?: string
  kind: ProductionTargetKind
  text: string
  meaning: string
  attempts: number
  hits: number
  misses: number
  streak: number
  lastAt: string
  dueAt: string
  lastArticleId?: string
  lastMode?: ProductionMode
}

export interface ProductionStats {
  attempts: number
  sessions: number
  rewrites: number
  modes: Record<string, number>
  targetAttempts: number
  targetHits: number
  targetMisses: number
  hitRate: number
  avgScore: number
}

export interface ProductionHistoryFilter {
  articleId?: string
  mode?: ProductionMode | 'all'
  topic?: string
}

export function productionTargetKey(kind: ProductionTargetKind, text: string): string {
  return `${kind}:${text.trim().toLowerCase().replace(/\s+/g, ' ')}`
}

export function productionRecords(history: readonly WritingRecord[]): WritingRecord[] {
  return history.filter((r) => r.source === 'production')
}

export function productionTaskOf(record: WritingRecord): ProductionTask | null {
  return isProductionTask(record.task) ? record.task : null
}

export interface SkippedProductionRecordInput {
  task: ProductionTask
  text: string
  at: string
  articleId: string
  articleTitle: string
  round: number
}

/** 跳过题留档：保留已写草稿与题面，但不伪造 AI 分数。 */
export function makeSkippedProductionRecord(input: SkippedProductionRecordInput): WritingRecord {
  return {
    at: input.at,
    articleId: input.articleId,
    articleTitle: input.articleTitle,
    model: input.task.model,
    text: input.text,
    feedback: skippedProductionFeedback(),
    task: { ...input.task, round: input.round, skipped: true } as ProductionTask,
    source: 'production',
  }
}

/** 记录里这次判分的目标块；老记录没有 hits 时返回空，不猜。 */
export function productionRecordHits(record: WritingRecord): ProductionTargetHit[] {
  return productionHits(record.task)
}

const DUE_DAYS = [1, 3, 7, 14, 30, 60, 120]

function addDays(iso: string, days: number): string {
  const t = Date.parse(iso)
  if (!Number.isFinite(t)) return iso
  return new Date(t + days * 86_400_000).toISOString()
}

/**
 * 从 attempts 推导目标块进度：命中一次升一档，漏一次立刻到期。
 * 同一天可以重复练，但 `streak` 只在命中时增长。
 */
export function deriveProductionProgress(records: readonly WritingRecord[]): ProductionProgress[] {
  const map = new Map<string, ProductionProgress>()
  for (const rec of records) {
    const task = productionTaskOf(rec)
    if (!task) continue
    const hits = productionRecordHits(rec)
    for (const hit of hits) {
      const key = productionTargetKey(hit.kind, hit.text)
      const prev = map.get(key)
      const target = task.targets.find((t) => productionTargetKey(t.kind, t.text) === key)
      const base: ProductionProgress = prev ?? {
        key,
        ...(target?.itemId ? { itemId: target.itemId } : {}),
        kind: hit.kind,
        text: hit.text,
        meaning: hit.meaning,
        attempts: 0,
        hits: 0,
        misses: 0,
        streak: 0,
        lastAt: rec.at,
        dueAt: rec.at,
      }
      const streak = hit.used ? base.streak + 1 : 0
      map.set(key, {
        ...base,
        attempts: base.attempts + 1,
        hits: base.hits + (hit.used ? 1 : 0),
        misses: base.misses + (hit.used ? 0 : 1),
        streak,
        lastAt: rec.at,
        dueAt: hit.used ? addDays(rec.at, DUE_DAYS[Math.min(streak - 1, DUE_DAYS.length - 1)]) : rec.at,
        lastArticleId: rec.articleId,
        lastMode: task.mode,
      })
    }
  }
  return [...map.values()]
}

export function progressByKey(progress: readonly ProductionProgress[]): Map<string, ProductionProgress> {
  return new Map(progress.map((p) => [p.key, p]))
}

export function productionDueAt(progress: ProductionProgress): string {
  return progress.dueAt
}

export function isProgressDue(progress: ProductionProgress, nowIso: string): boolean {
  const due = Date.parse(progress.dueAt)
  const now = Date.parse(nowIso)
  return !Number.isFinite(due) || !Number.isFinite(now) || due <= now
}

export function isProgressWeak(progress: ProductionProgress): boolean {
  return progress.misses > 0 || progress.hits / Math.max(1, progress.attempts) < 0.7
}

export interface ProductionReviewCounts {
  due: number
  weak: number
  /** 全库候选里还没练过的目标块；不传候选时保持 0。 */
  newTargets: number
}

/** 顶栏 / 今日计划用的目标块提醒数：到期 + 薄弱 + 新目标。 */
export function productionReviewCounts(
  progress: readonly ProductionProgress[],
  nowIso: string,
  candidates: readonly ProductionTarget[] = [],
): ProductionReviewCounts {
  let due = 0
  let weak = 0
  for (const p of progress) {
    if (isProgressDue(p, nowIso)) due++
    if (isProgressWeak(p)) weak++
  }
  const keys = new Set(progress.map((p) => p.key))
  const newTargets = candidates.filter((t) => !keys.has(productionTargetKey(t.kind, t.text))).length
  return { due, weak, newTargets }
}

export function isProgressRecent(progress: ProductionProgress, nowIso: string, days = 7): boolean {
  const last = Date.parse(progress.lastAt)
  const now = Date.parse(nowIso)
  if (!Number.isFinite(last) || !Number.isFinite(now)) return false
  return now - last <= days * 86_400_000
}

export function productionStats(records: readonly WritingRecord[]): ProductionStats {
  const production = productionRecords(records)
  const modes: Record<string, number> = {}
  const sessions = new Set<string>()
  let attempts = 0
  let rewrites = 0
  let score = 0
  let scored = 0
  let targetAttempts = 0
  let targetHits = 0
  for (const rec of production) {
    const task = productionTaskOf(rec)
    // 跳过稿只进历史，不算一次真实产出，也不拉低平均分。
    if (task?.skipped) continue
    attempts++
    const mode = task?.mode ?? 'unknown'
    modes[mode] = (modes[mode] ?? 0) + 1
    if (task?.sessionId) sessions.add(task.sessionId)
    if ((task?.round ?? 1) > 1) rewrites++
    if (rec.feedback?.max > 0) {
      score += rec.feedback.total
      scored++
    }
    const hits = productionRecordHits(rec)
    targetAttempts += hits.length
    targetHits += hits.filter((h) => h.used).length
  }
  return {
    attempts,
    sessions: sessions.size,
    rewrites,
    modes,
    targetAttempts,
    targetHits,
    targetMisses: targetAttempts - targetHits,
    hitRate: targetAttempts ? targetHits / targetAttempts : 0,
    avgScore: scored ? score / scored : 0,
  }
}

export interface ProductionTrend {
  recentAttempts: number
  recentHits: number
  recentHitRate: number
  /** 第 2 稿相对第 1 稿的平均分差（只算成组的两稿）。 */
  rewriteGain: number
}

/** 最近 N 天的目标块命中率 + 重写平均提分。 */
export function productionTrend(
  records: readonly WritingRecord[],
  nowIso: string,
  days = 7,
): ProductionTrend {
  const now = Date.parse(nowIso)
  let recentAttempts = 0
  let recentHits = 0
  for (const rec of productionRecords(records)) {
    const at = Date.parse(rec.at)
    if (!Number.isFinite(now) || !Number.isFinite(at) || now - at > days * 86_400_000) continue
    const hits = productionRecordHits(rec)
    recentAttempts += hits.length
    recentHits += hits.filter((h) => h.used).length
  }
  let gainSum = 0
  let gainCount = 0
  for (const group of groupProductionAttempts(records)) {
    const first = group.records.find((r) => (productionTaskOf(r)?.round ?? 1) === 1)
    const second = group.records.find((r) => (productionTaskOf(r)?.round ?? 1) === 2)
    if (first && second) {
      gainSum += second.feedback.total - first.feedback.total
      gainCount++
    }
  }
  return {
    recentAttempts,
    recentHits,
    recentHitRate: recentAttempts ? recentHits / recentAttempts : 0,
    rewriteGain: gainCount ? gainSum / gainCount : 0,
  }
}

export interface ProductionErrorStat {
  key: string
  rule: string
  count: number
  sample: string
}

/** 批改里的高频错因（按 rule + key 聚合，最多 5 条）。 */
export function productionTopErrors(records: readonly WritingRecord[], limit = 5): ProductionErrorStat[] {
  const map = new Map<string, ProductionErrorStat>()
  for (const rec of productionRecords(records)) {
    for (const issue of rec.feedback.issues) {
      const key = `${issue.rule}|${issue.key}`
      const prev = map.get(key)
      if (prev) prev.count++
      else map.set(key, { key, rule: issue.rule, count: 1, sample: issue.original || issue.suggestion })
    }
  }
  return [...map.values()].sort((a, b) => b.count - a.count).slice(0, limit)
}

export function filterProductionHistory(
  records: readonly WritingRecord[],
  filter: ProductionHistoryFilter = {},
): WritingRecord[] {
  const topic = filter.topic?.trim().toLowerCase()
  return productionRecords(records).filter((rec) => {
    const task = productionTaskOf(rec)
    if (filter.articleId && rec.articleId !== filter.articleId) return false
    if (filter.mode && filter.mode !== 'all' && task?.mode !== filter.mode) return false
    if (topic && !`${task?.topic ?? ''} ${task?.task ?? ''}`.toLowerCase().includes(topic)) return false
    return true
  })
}

export interface ProductionAttemptGroup {
  key: string
  sessionId?: string
  promptId: string
  title: string
  /** 旧记录没有 sessionId，只做了日期兜底分组。 */
  legacy?: boolean
  records: WritingRecord[]
}

/** 按 session + prompt 分组，方便把第 1 稿 / 第 2 稿并排看。 */
export function groupProductionAttempts(records: readonly WritingRecord[]): ProductionAttemptGroup[] {
  const groups = new Map<string, ProductionAttemptGroup>()
  for (const rec of productionRecords(records)) {
    const task = productionTaskOf(rec)
    if (!task) continue
    // 旧记录没有 sessionId：按「同一天 + 文章 + 模式 + 主题」兜底，
    // 至少让同一次两稿还能并排；不同天的会自然分开。
    const legacy = `legacy:${rec.at.slice(0, 10)}|${rec.articleId}|${task.mode}|${task.topic}`
    const key = `${task.sessionId ?? legacy}|${task.promptId}`
    const prev = groups.get(key)
    if (prev) prev.records.push(rec)
    else {
      groups.set(key, {
        key,
        ...(task.sessionId ? { sessionId: task.sessionId } : { legacy: true }),
        promptId: task.promptId,
        title: task.task || task.topic,
        records: [rec],
      })
    }
  }
  for (const group of groups.values()) {
    group.records.sort((a, b) => {
      const ar = productionTaskOf(a)?.round ?? 1
      const br = productionTaskOf(b)?.round ?? 1
      return ar - br || a.at.localeCompare(b.at)
    })
  }
  return [...groups.values()].sort((a, b) => {
    const at = a.records[a.records.length - 1]?.at ?? ''
    const bt = b.records[b.records.length - 1]?.at ?? ''
    return bt.localeCompare(at)
  })
}

function mdEscape(s: string): string {
  return s.replace(/\|/g, '\\|').replace(/\n+/g, ' ')
}

/** 工棚历史导出：按次列出作答、分数、问题、目标块命中，便于归档。 */
export function productionHistoryMarkdown(records: readonly WritingRecord[]): string {
  const lines: string[] = ['# 奶牛工棚产出记录', '']
  for (const rec of productionRecords(records)) {
    const task = productionTaskOf(rec)
    const label = task?.mode ?? '产出'
    const hits = productionRecordHits(rec)
    lines.push(`## ${dayKeyLocal(new Date(rec.at))} · ${label} · ${rec.articleTitle || rec.articleId}`)
    lines.push('')
    if (task?.topic) lines.push(`- 主题：${task.topic}`)
    if (task?.task) lines.push(`- 题目：${task.task}`)
    if (task?.skipped) lines.push('- 状态：跳过（未提交，无 AI 批改）')
    else lines.push(`- 分数：${rec.feedback.total}/${rec.feedback.max}`)
    if (task?.reference) lines.push(`- 参考译文：${task.reference}`)
    lines.push('', '**作答**', '', rec.text || '（空）', '')
    if (hits.length) {
      lines.push('**目标块**', '')
      for (const hit of hits) {
        lines.push(`- ${hit.used ? '✅' : '❌'} ${hit.text}${hit.meaning ? `（${hit.meaning}）` : ''}`)
      }
      lines.push('')
    }
    if (rec.feedback.issues.length) {
      lines.push('**问题**', '')
      for (const issue of rec.feedback.issues) {
        lines.push(
          `- ${mdEscape(issue.original)} → ${mdEscape(issue.suggestion)}${issue.reason ? `（${mdEscape(issue.reason)}）` : ''}`,
        )
      }
      lines.push('')
    }
    if (rec.feedback.summary) lines.push(`**总评**：${rec.feedback.summary}`, '')
  }
  return lines.join('\n')
}

/** 历史列表里一条记录的身份（不依赖 DB 自增 id）。 */
export function productionRecordKey(record: WritingRecord): string {
  return writingRecordKey(record)
}
