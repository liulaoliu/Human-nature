/**
 * 生词浏览页的**筛选口径**（纯函数）。
 *
 * 为什么单独一个 core 模块：面板上有范围（全部 / 本篇 / 选篇）+ 类型 + 搜索 + 日期 + 状态，
 * 这些判断要是留在组件里，就只能挂 React 才能测；而且「本篇 / 选篇」一换数据源，
 * 很容易又写一份“哪些词属于这篇”的规则。
 *
 * 口径：
 *   - 本篇 / 选篇只认 `articleEntries`，走 `articleEntryViewsFrom`（和侧栏、打印同一份）；
 *   - 日期用 `createdAt` + `dayKeyLocal`（入库日，04:00 结算），和打印 / 导出的 `dayOf` 一致；
 *   - 类型只分「生词（普通单词）/ 语言点（词组·习语·用法）」，细分交给 `entryKind`；
 *   - 状态复用 `core/vocab/review` 的 `isDue` / `isFresh`，别在视图里另写一套“到期/新词”；
 *   - 已掌握默认不出现，由 `includeMastered` 显式打开（浏览页可以看，但学习/编号不要）。
 */
import type { ArticleVocabEntry, VocabItem } from '../types/document'
import { dayKeyLocal } from './activity'
import { articleEntryViewsFrom } from './articleVocab'
import { resolveArticleMeaning } from './articleMeaning'
import { kindOf } from './entryKind'
import type { PrintRow } from './printPlan'
import { isDue, isFresh } from './vocab/review'

export type BrowseScope = 'all' | 'article' | 'picked'
export type BrowseKind = 'all' | 'word' | 'lang'
export type BrowseStatus = 'all' | 'due' | 'fresh' | 'lapsed' | 'mastered'

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
  /** 选中的入库日；空集合 = 全部日期 */
  days?: ReadonlySet<string>
  /** 复习状态筛选 */
  status?: BrowseStatus
  /** 是否显示已掌握（`status === 'mastered'` 时忽略） */
  includeMastered: boolean
  /** 判定「到期」的时刻（测试固定；不传 = now） */
  now?: Date
}

export interface VocabBrowseResult {
  /** 过滤后的条目（未排序；排序交给 `sortItems`） */
  items: VocabItem[]
  /** 当前范围内有内容的日期（倒序）+ 条数 */
  days: [string, number][]
  dayCounts: Map<string, number>
  /** 选篇列表每篇的条数（跟类型 / 搜索 / 日期 / 状态走；全部范围为空） */
  articleCounts: Map<string, number>
  /** 范围 + 含已掌握之后、类型 / 搜索 / 日期 / 状态之前的条数 */
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

/**
 * 状态筛选。`mastered` 是明确的「只看已掌握」，不受 includeMastered 影响；
 * 其他状态仍然遵守 includeMastered（本篇 / 选篇默认不看已掌握）。
 */
function matchStatus(item: VocabItem, input: VocabBrowseInput, now: Date): boolean {
  const status = input.status ?? 'all'
  if (status === 'mastered') return item.status === 'mastered'
  if (!input.includeMastered && item.status === 'mastered') return false
  if (status === 'due') return isDue(item, now)
  if (status === 'fresh') return item.status !== 'mastered' && isFresh(item)
  if (status === 'lapsed') return (item.reviewState.lapses ?? 0) > 0
  return true
}

function matchDays(item: VocabItem, days: ReadonlySet<string> | undefined): boolean {
  if (!days || days.size === 0) return true
  return days.has(dayOf(item))
}

/**
 * 某篇（可带别名）的条目。选篇时把选中篇的所有归属键并成一个集合，
 * 这样同 lemma 只出现一次（浏览页是「词条列表」，不是打印的「按篇行」）。
 */
function sourceItems(input: VocabBrowseInput): VocabItem[] {
  const entries = input.articleEntries ?? []
  /** 「只看已掌握」必须把 mastered 放进 source，否则 matchStatus 永远看不到它们。 */
  const wantMastered = input.includeMastered || input.status === 'mastered'
  const opts = { includeLang: true, includeMastered: wantMastered }

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

  return wantMastered ? input.items : input.items.filter((it) => it.status !== 'mastered')
}

/** 选篇列表的每篇条数：跟当前类型 / 搜索 / 日期 / 状态一致，用户看到的就是能点出来的数。 */
function countByArticle(input: VocabBrowseInput, q: string, now: Date): Map<string, number> {
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
      !matchStatus(item, input, now) ||
      !matchKind(item, input.kind) ||
      !matchQuery(item, q) ||
      !matchDays(item, input.days)
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
  const now = input.now ?? new Date()
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
      matchStatus(it, input, now) &&
      matchKind(it, input.kind) &&
      matchQuery(it, q) &&
      matchDays(it, input.days),
  )

  return {
    items,
    days,
    dayCounts,
    articleCounts: input.scope === 'picked' ? countByArticle(input, q, now) : new Map(),
    scopeCount: source.length,
  }
}

/**
 * 「选篇」A4 的行：一个词在 A/B 各一篇就各出一行（打印允许跨篇重复），
 * 编号按该篇条目顺序 1..n，释义用该篇语境。
 *
 * 为什么不复用 `planPrint.rowsForArticle`：那边拿的是打印面板的 `content` 口径，
 * 这里要跟浏览页的类型 / 搜索 / 日期 / 状态筛选一致；两边共用 `articleEntryViewsFrom`，
 * 归属规则只留一份。
 *
 * 只有 `scope === 'picked'` 有意义：本篇有正文编号（`articleNums`），全部是普通词表。
 */
export function browseA4Rows(input: VocabBrowseInput): PrintRow[] {
  if (input.scope !== 'picked') return []
  const picked = input.pickedArticleIds
  if (!picked?.size) return []
  const refs = (input.articles ?? []).filter((a) => picked.has(a.id))
  if (!refs.length) return []

  const entries = input.articleEntries ?? []
  const wantMastered = input.includeMastered || input.status === 'mastered'
  const q = input.query.trim().toLowerCase()
  const now = input.now ?? new Date()
  const rows: PrintRow[] = []

  for (const ref of refs) {
    const ids = new Set([ref.id, ...(ref.aliases ?? [])])
    const views = articleEntryViewsFrom(input.items, entries, ids, {
      includeLang: true,
      includeMastered: wantMastered,
    })
    let wordNo = 0
    for (const { entry, item } of views) {
      if (
        !matchStatus(item, input, now) ||
        !matchKind(item, input.kind) ||
        !matchQuery(item, q) ||
        !matchDays(item, input.days)
      ) {
        continue
      }
      const isWord = kindOf(item) === 'word'
      if (isWord) wordNo += 1
      const resolved = resolveArticleMeaning(item, entry, entry.articleId, entry.sentenceId)
      rows.push({
        item,
        articleId: entry.articleId,
        articleTitle: ref.title,
        number: isWord ? wordNo : null,
        meaning: resolved?.text ?? null,
      })
    }
  }
  return rows
}
