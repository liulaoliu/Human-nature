import { isGoldenWritingRecord, type WritingRecord } from './writing'

/**
 * 仿写历史视图的筛选口径。
 *
 * 存储仍是同一个 `writingHistory`（SQLite `writing_records`），这里只决定
 * 「这个面板看哪一段」：来源按 `source` 分组，范围按文章归属分「本篇 / 全库」。
 * 金句课记录有自己的「学习历史」入口，不混进这里的筛选。
 */
export type WritingHistorySource = 'all' | 'writing' | 'production' | 'drillSentence'

export type WritingHistoryScope = 'article' | 'all'

export interface WritingHistoryFilter {
  source: WritingHistorySource
  scope: WritingHistoryScope
  /** `scope='article'` 时只看这篇；空串时本篇为空，不影响全库。 */
  articleId: string
}

export const WRITING_HISTORY_SOURCES: readonly WritingHistorySource[] = [
  'all',
  'writing',
  'production',
  'drillSentence',
]

export const WRITING_HISTORY_SOURCE_LABEL: Record<WritingHistorySource, string> = {
  all: '全部来源',
  writing: '普通仿写',
  production: '奶牛工棚',
  drillSentence: '拷打造句',
}

/** 一条记录在筛选器里归哪一组；旧记录没有 source 时按普通仿写算。 */
export function writingHistorySourceOf(rec: WritingRecord): Exclude<WritingHistorySource, 'all'> {
  if (rec.source === 'production') return 'production'
  if (rec.source === 'drillSentence') return 'drillSentence'
  return 'writing'
}

/** 这条记录是否属于仿写训练的历史视图（金句课记录由金句课自己展示）。 */
export function isWritingHistoryVisible(rec: WritingRecord): boolean {
  return !isGoldenWritingRecord(rec)
}

function matchesFilter(rec: WritingRecord, filter: WritingHistoryFilter): boolean {
  if (!isWritingHistoryVisible(rec)) return false
  if (filter.scope === 'article' && rec.articleId !== filter.articleId) return false
  return filter.source === 'all' || writingHistorySourceOf(rec) === filter.source
}

/** 按范围 + 来源筛选，并按时间倒序（最近的在前）。 */
export function filterWritingHistory(
  history: readonly WritingRecord[],
  filter: WritingHistoryFilter,
): WritingRecord[] {
  return history
    .filter((rec) => matchesFilter(rec, filter))
    .sort((a, b) => b.at.localeCompare(a.at))
}

/**
 * 当前范围内各来源的条数；`all` 是总数，用于按钮和下拉的括号数字。
 * 只算仿写训练能看到的记录，金句课记录不参与。
 */
export function writingHistoryCounts(
  history: readonly WritingRecord[],
  scope: WritingHistoryScope,
  articleId: string,
): Record<WritingHistorySource, number> {
  const counts: Record<WritingHistorySource, number> = {
    all: 0,
    writing: 0,
    production: 0,
    drillSentence: 0,
  }
  for (const rec of history) {
    if (!isWritingHistoryVisible(rec)) continue
    if (scope === 'article' && rec.articleId !== articleId) continue
    counts.all += 1
    counts[writingHistorySourceOf(rec)] += 1
  }
  return counts
}

/**
 * 删除当前筛选范围内的记录；金句课记录永远保留，不在这个面板里清。
 *
 * 用来源 + 范围判定，而不是先取列表再按对象身份删：同步 / 合并后同一条记录
 * 可能换了对象引用，但 `source` / `articleId` / 时间这些字段不会变。
 */
export function removeWritingHistory(
  history: readonly WritingRecord[],
  filter: WritingHistoryFilter,
): WritingRecord[] {
  return history.filter((rec) => isGoldenWritingRecord(rec) || !matchesFilter(rec, filter))
}
