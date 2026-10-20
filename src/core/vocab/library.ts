import type { VocabItem, VocabLibrary, VocabStatus } from '../../types/document'
import { SCHEMA_VERSION } from '../../types/document'
import { dayKeyLocal } from '../activity'
import { lemmaOf } from './word'

/**
 * 词库本身的增删改与查询：新建、编辑、状态、删除、打印标记、优先重排、
 * 本篇归属、筛选 / 分组 / 排序。
 *
 * 纯函数；不做词形/合并规则（那些在 `word.ts` / `merge.ts`）。
 */

/** 空词库。 */
export function createLibrary(): VocabLibrary {
  return { schemaVersion: SCHEMA_VERSION, items: [] }
}

/** 手动编辑一个词条，默认把状态置为 edited（不会被后续查询覆盖）。 */
export function editItem(
  library: VocabLibrary,
  id: string,
  patch: Partial<Omit<VocabItem, 'id' | 'lemma'>>,
  now: Date = new Date(),
): VocabLibrary {
  return {
    ...library,
    items: library.items.map((it) =>
      it.id === id ? { ...it, ...patch, status: patch.status ?? 'edited', updatedAt: now.toISOString() } : it,
    ),
  }
}

export function setStatus(
  library: VocabLibrary,
  id: string,
  status: VocabStatus,
  now: Date = new Date(),
): VocabLibrary {
  return {
    ...library,
    items: library.items.map((it) =>
      it.id === id ? { ...it, status, updatedAt: now.toISOString() } : it,
    ),
  }
}

export function removeItem(library: VocabLibrary, id: string): VocabLibrary {
  return { ...library, items: library.items.filter((it) => it.id !== id) }
}

/**
 * 记录 A4 打印：把传进来的这批词条写上 `lastPrintedAt`。
 * 打印后调用，用于「不重复打印」（下次可只打印未打印的）。
 * 纯函数，不改别的字段，方便单测。
 */
export function markPrinted(
  library: VocabLibrary,
  ids: Iterable<string>,
  now: Date = new Date(),
): VocabLibrary {
  const set = new Set(ids)
  if (!set.size) return library
  const iso = now.toISOString()
  return {
    ...library,
    items: library.items.map((it) => (set.has(it.id) ? { ...it, lastPrintedAt: iso, updatedAt: iso } : it)),
  }
}

/** 是否打印过（老数据没有 lastPrintedAt，按未打印算）。 */
export function isPrinted(item: VocabItem): boolean {
  return !!item.lastPrintedAt
}

/** 未打印过的词条（用于「只打未打印」）。 */
export function unprintedItems(items: VocabItem[]): VocabItem[] {
  return items.filter((it) => !it.lastPrintedAt)
}

/**
 * 答错的词 → 标记「优先重排」到 `until`（默认次日）。
 * 队列会把这些词排到最前，实现「今日鞭打、次日优先重练」。
 */
export function prioritizeItems(library: VocabLibrary, ids: Iterable<string>, until: string): VocabLibrary {
  const set = new Set(ids)
  if (!set.size) return library
  return {
    ...library,
    items: library.items.map((it) => (set.has(it.id) ? { ...it, priorityUntil: until } : it)),
  }
}

/** 是否正处于「优先重排」（priorityUntil 未过期）。 */
export function isPriority(item: VocabItem, now: Date = new Date()): boolean {
  return !!item.priorityUntil && new Date(item.priorityUntil) > now
}

/**
 * 某篇文章的「本篇生词」：来源是本文，**或本文正文里出现过该词**。
 *
 * 为什么不能只看 `source`：`markWord` 按 lemma 去重时沿用**旧来源**
 * （`source: existing.source ?? source`），所以从别的文章带过来的同一个词，
 * 来源会留在旧文章 —— 只按 source 过滤，「本篇生词」会一直不涨。
 */
export function articleWordsOf(
  library: VocabLibrary,
  articleIdentity: string,
  docLemmas: Set<string>,
): VocabItem[] {
  return library.items.filter(
    (it) => it.source?.fileName === articleIdentity || docLemmas.has(it.lemma),
  )
}

/** 按词形（lemma）删除。 */
export function removeByLemma(library: VocabLibrary, word: string): VocabLibrary {
  const lemma = lemmaOf(word)
  return { ...library, items: library.items.filter((it) => it.lemma !== lemma) }
}

export interface VocabFilter {
  status?: VocabStatus[]
  articleId?: string
  tag?: string
  /** 在 word / meaning / usage 里模糊匹配 */
  query?: string
  /** 到期时间早于该时刻 */
  dueBefore?: Date
}

export function filterItems(items: VocabItem[], filter: VocabFilter): VocabItem[] {
  const q = filter.query?.trim().toLowerCase()
  return items.filter((it) => {
    if (filter.status && !filter.status.includes(it.status)) return false
    if (filter.articleId && it.source?.articleId !== filter.articleId) return false
    if (filter.tag && !it.tags.includes(filter.tag)) return false
    if (filter.dueBefore) {
      if (!it.reviewState.due) return false
      if (new Date(it.reviewState.due) > filter.dueBefore) return false
    }
    if (q) {
      const hay = `${it.word} ${it.meaning ?? ''} ${it.usage.join(' ')}`.toLowerCase()
      if (!hay.includes(q)) return false
    }
    return true
  })
}

export type VocabGroupBy = 'alphabet' | 'article' | 'date' | 'status'

export interface VocabGroup {
  key: string
  items: VocabItem[]
}

export function groupItems(items: VocabItem[], by: VocabGroupBy): VocabGroup[] {
  const map = new Map<string, VocabItem[]>()
  for (const it of items) {
    let key: string
    if (by === 'alphabet') {
      const c = it.lemma[0]?.toUpperCase() ?? '#'
      key = /[A-Z]/.test(c) ? c : '#'
    } else if (by === 'article') {
      key = it.source?.articleId ?? '未分类'
    } else if (by === 'date') {
      key = dayKeyLocal(new Date(it.createdAt))
    } else {
      key = it.status
    }
    const arr = map.get(key)
    if (arr) arr.push(it)
    else map.set(key, [it])
  }
  return [...map.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => ({ key, items: value }))
}

export type VocabSortBy = 'word' | 'createdAt' | 'updatedAt' | 'due'

export function sortItems(items: VocabItem[], by: VocabSortBy): VocabItem[] {
  const out = [...items]
  out.sort((a, b) => {
    if (by === 'word') return a.lemma.localeCompare(b.lemma)
    if (by === 'createdAt') return b.createdAt.localeCompare(a.createdAt)
    if (by === 'updatedAt') return b.updatedAt.localeCompare(a.updatedAt)
    const da = a.reviewState.due
    const db = b.reviewState.due
    if (da === null && db === null) return 0
    if (da === null) return 1
    if (db === null) return -1
    return da.localeCompare(db)
  })
  return out
}
