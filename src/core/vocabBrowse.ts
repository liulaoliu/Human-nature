/**
 * 生词浏览页的**筛选口径**（纯函数）。
 *
 * 为什么单独一个 core 模块：面板上有范围（全部 / 本篇 / 选篇）+ 类型 + 搜索 + 日期，
 * 这些判断要是留在组件里，就只能挂 React 才能测；而且「本篇 / 选篇」一换数据源，
 * 很容易又写一份“哪些词属于这篇”的规则。
 *
 * 口径：
 *   - 本篇 / 选篇只认 `articleEntries`，走 `articleEntryViewsFrom`（和侧栏、打印同一份）；
 *   - 日期用 `createdAt` + `dayKeyLocal`（入库日，04:00 结算），和打印 / 导出的 `dayOf` 一致；
 *   - 类型只分「生词（普通单词）/ 语言点（词组·习语·用法）」，细分交给 `entryKind`；
 *   - 已掌握默认不出现，由 `includeMastered` 显式打开（浏览页可以看，但学习/编号不要）。
 */
import type { ArticleVocabEntry, VocabItem } from '../types/document'
import { dayKeyLocal } from './activity'
import { articleEntryViewsFrom } from './articleVocab'
import { kindOf } from './entryKind'

export type BrowseScope = 'all' | 'article' | 'picked'
export type BrowseKind = 'all' | 'word' | 'lang'
/** `'all'` = 全部日期；其他是 `dayKeyLocal` 的日期键。 */
export type BrowseDay = 'all' | string

/** 选篇列表里的一篇（只要归属键，标题给界面用）。 */
export interface BrowseArticleRef {
  id: string
  title: string
  aliases?: string[]
}

export interface VocabBrowseInput {
  /** 整个词库 */
  items: VocabItem[]
  scope: BrowseScope
  /** 当前篇的稳定标识（`articleIdentity`） */
  articleId?: string
  /** 整库按篇收录表 */
  articleEntries?: ArticleVocabEntry[]
  /** 已保存文章（选篇用） */
  articles?: BrowseArticleRef[]
  /** 选篇勾选的文章 id */
  pickedArticleIds?: ReadonlySet<string>
  kind: BrowseKind
  /** 搜索词；空串 = 不过滤 */
  query: string
  day: BrowseDay
  /** 是否显示已掌握 */
  includeMastered: boolean
}

export interface VocabBrowseResult {
  /** 过滤后的条目（未排序；排序交给 `sortItems`） */
  items: VocabItem[]
  /** 当前范围内有内容的日期（倒序）+ 条数 */
  days: [string, number][]
  dayCounts: Map<string, number>
  /** 选篇列表每篇的条数（跟类型 / 搜索 / 日期走；全部范围为空） */
  articleCounts: Map<string, number>
  /** 范围 + 含已掌握之后、类型 / 搜索 / 日期之前的条数 */
  scopeCount: number
}

/** 入库日（逻辑日）；坏日期不参与分天，避免出现 "NaN-NaN-NaN"。 */
function dayOf(item: VocabItem): string {
  const d = new Date(item.createdAt)
  return Number.isNaN(d.getTime()) ? '' : dayKeyLocal(d)
}

function matchKind(item: VocabItem, kind: BrowseKind): boolean {
  if (kind === 'all') return true
  return kind === 'word' ? kindOf(item) === 'word' : kindOf(item) !== 'word'
}

function matchQuery(item: VocabItem, q: string): boolean {
  if (!q) return true
  return [item.word, item.lemma, item.meaning, item.note, item.definition].some(
    (v) => typeof v === 'string' && v.toLowerCase().includes(q),
  )
}

function matchStatus(item: VocabItem, includeMastered: boolean): boolean {
  return includeMastered || item.status !== 'mastered'
}

/**
 * 某篇（可带别名）的条目。选篇时把选中篇的所有归属键并成一个集合，
 * 这样同 lemma 只出现一次（浏览页是「词条列表」，不是打印的「按篇行」）。
 */
function sourceItems(input: VocabBrowseInput): VocabItem[] {
  const entries = input.articleEntries ?? []
  const opts = { includeLang: true, includeMastered: input.includeMastered }

  if (input.scope === 'article') {
    if (!input.articleId) return []
    return articleEntryViewsFrom(input.items, entries, [input.articleId], opts).map((v) => v.item)
  }

  if (input.scope === 'picked') {
    const picked = input.pickedArticleIds
    if (!picked?.size) return []
    const ids = new Set<string>()
    for (const a of input.articles ?? []) {
      if (!picked.has(a.id)) continue
      ids.add(a.id)
      for (const alias of a.aliases ?? []) ids.add(alias)
    }
    return ids.size ? articleEntryViewsFrom(input.items, entries, ids, opts).map((v) => v.item) : []
  }

  return input.includeMastered ? input.items : input.items.filter((it) => it.status !== 'mastered')
}

/** 选篇列表的每篇条数：跟当前类型 / 搜索 / 日期一致，用户看到的就是能点出来的数。 */
function countByArticle(
  input: VocabBrowseInput,
  q: string,
): Map<string, number> {
  const counts = new Map<string, number>()
  const entries = input.articleEntries ?? []
  const refs = input.articles ?? []
  if (!refs.length) return counts

  const byLemma = new Map(input.items.map((it) => [it.lemma, it]))
  const aliasTo = new Map<string, string>()
  for (const a of refs) {
    aliasTo.set(a.id, a.id)
    for (const alias of a.aliases ?? []) if (!aliasTo.has(alias)) aliasTo.set(alias, a.id)
  }
  const seen = new Map<string, Set<string>>()
  for (const a of refs) counts.set(a.id, 0)

  for (const entry of entries) {
    const refId = aliasTo.get(entry.articleId)
    if (!refId) continue
    const item = byLemma.get(entry.lemma)
    if (!item) continue
    let got = seen.get(refId)
    if (!got) {
      got = new Set()
      seen.set(refId, got)
    }
    if (got.has(entry.lemma)) continue
    if (
      !matchStatus(item, input.includeMastered) ||
      !matchKind(item, input.kind) ||
      !matchQuery(item, q) ||
      (input.day !== 'all' && dayOf(item) !== input.day)
    ) {
      continue
    }
    got.add(entry.lemma)
    counts.set(refId, (counts.get(refId) ?? 0) + 1)
  }
  return counts
}

export function browseVocab(input: VocabBrowseInput): VocabBrowseResult {
  const q = input.query.trim().toLowerCase()
  const source = sourceItems(input)

  const dayCounts = new Map<string, number>()
  for (const item of source) {
    const day = dayOf(item)
    if (!day) continue
    dayCounts.set(day, (dayCounts.get(day) ?? 0) + 1)
  }
  const days = [...dayCounts.entries()].sort((a, b) => b[0].localeCompare(a[0]))

  const items = source.filter(
    (it) =>
      matchStatus(it, input.includeMastered) &&
      matchKind(it, input.kind) &&
      matchQuery(it, q) &&
      (input.day === 'all' || dayOf(it) === input.day),
  )

  return {
    items,
    days,
    dayCounts,
    articleCounts: input.scope === 'picked' ? countByArticle(input, q) : new Map(),
    scopeCount: source.length,
  }
}
