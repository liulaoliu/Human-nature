import type { ArticleVocabEntry, VocabItem, VocabLibrary, VocabTombstone } from '../../types/document'

/**
 * 词库删除墓碑 + 本机/服务端合并。
 *
 * 为什么需要：
 *   - 只按 lemma 取并集，会把用户删掉的词复活（本机没这条 ≠ 用户删了这条）；
 *   - 只按整库时间戳选一边，会丢掉另一边的新增/修改。
 *
 * 规则：
 *   - 删除时写墓碑（`kind` + `key` + `at`）；合并时先并墓碑，再按 `updatedAt` 取更新的词条。
 *   - 墓碑只删除**比墓碑旧**的词条；删完又加回来的（updatedAt 更晚）保留。
 *   - 同一条两边都改过：`updatedAt` 更新的赢；完全相同则本机赢（本机是未同步的一方）。
 */

export function itemTombstoneKey(id: string): string {
  return `item:${id}`
}

export function articleTombstoneKey(articleId: string, lemma: string): string {
  return `article:${articleId}\u0000${lemma}`
}

function newerTombstone(a: VocabTombstone, b: VocabTombstone): VocabTombstone {
  return Date.parse(b.at) >= Date.parse(a.at) ? b : a
}

/** 加/更新一条墓碑；同一 key 只留最新时间。 */
export function addTombstone(library: VocabLibrary, tombstone: VocabTombstone): VocabLibrary {
  const list = library.tombstones ?? []
  const idx = list.findIndex((t) => t.key === tombstone.key)
  if (idx < 0) return { ...library, tombstones: [...list, tombstone] }
  const prev = list[idx]
  const next = newerTombstone(prev, tombstone)
  if (next === prev) return library
  const tombstones = [...list]
  tombstones[idx] = next
  return { ...library, tombstones }
}

export function addItemTombstone(library: VocabLibrary, item: VocabItem, at = new Date().toISOString()): VocabLibrary {
  return addTombstone(library, {
    kind: 'item',
    key: itemTombstoneKey(item.id),
    at,
    lemma: item.lemma,
  })
}

export function addArticleTombstone(
  library: VocabLibrary,
  articleId: string,
  lemma: string,
  at = new Date().toISOString(),
): VocabLibrary {
  return addTombstone(library, { kind: 'article', key: articleTombstoneKey(articleId, lemma), at, lemma })
}

/** 两份墓碑取并集，同 key 保留更晚的删除时间。 */
export function mergeTombstones(a: VocabTombstone[] = [], b: VocabTombstone[] = []): VocabTombstone[] {
  const byKey = new Map<string, VocabTombstone>()
  for (const t of [...a, ...b]) {
    if (!t || typeof t.key !== 'string' || !t.key) continue
    const prev = byKey.get(t.key)
    byKey.set(t.key, prev ? newerTombstone(prev, t) : t)
  }
  return [...byKey.values()]
}

const time = (iso: string | undefined | null): number => {
  const t = iso ? Date.parse(iso) : NaN
  return Number.isFinite(t) ? t : 0
}

/**
 * 应用墓碑：删掉比墓碑旧的词条 / 篇条目。
 *
 * 删除后又重新加回来的（`updatedAt` / `addedAt` 晚于墓碑）不删。
 */
export function applyTombstones(library: VocabLibrary): VocabLibrary {
  const tombstones = library.tombstones ?? []
  if (!tombstones.length) return library
  const itemTombs = tombstones.filter((t) => t.kind === 'item')
  const articleTombs = tombstones.filter((t) => t.kind === 'article')

  const items = library.items.filter((it) => {
    const at = time(it.updatedAt)
    return !itemTombs.some((t) => {
      const same = t.key === itemTombstoneKey(it.id) || (!!t.lemma && t.lemma === it.lemma)
      return same && at <= time(t.at)
    })
  })
  const articleEntries = library.articleEntries?.filter((e) => {
    const at = time(e.addedAt)
    // 删全库词条会连带删掉它在各篇的收录：服务端那份不能再并回来。
    const killedByItem = itemTombs.some((t) => !!t.lemma && t.lemma === e.lemma && at <= time(t.at))
    const killedByArticle = articleTombs.some(
      (t) => t.key === articleTombstoneKey(e.articleId, e.lemma) && at <= time(t.at),
    )
    return !killedByItem && !killedByArticle
  })
  const itemsChanged = items.length !== library.items.length
  const entriesChanged = !!articleEntries && !!library.articleEntries && articleEntries.length !== library.articleEntries.length
  if (!itemsChanged && !entriesChanged) return library
  return {
    ...library,
    items,
    ...(articleEntries ? { articleEntries } : {}),
  }
}

function pickItem(a: VocabItem, b: VocabItem): VocabItem {
  // b 是本机（后遍历）；同时间本机赢，因为本机是未同步的一方。
  return time(b.updatedAt) >= time(a.updatedAt) ? b : a
}

function pickEntry(a: ArticleVocabEntry, b: ArticleVocabEntry): ArticleVocabEntry {
  return time(b.addedAt) >= time(a.addedAt) ? b : a
}

/**
 * 本机/服务端同步用合并：并墓碑 + 按词条更新时间取新 + 应用墓碑。
 *
 * 与备份的 `mergeLibraries`（按字段互补）不同：这里同一条词只留更新的一版，
 * 避免“旧版里非空字段”把用户刚清空的释义又补回来。
 */
export function mergeLibrariesForSync(local: VocabLibrary, server: VocabLibrary): VocabLibrary {
  const byLemma = new Map<string, VocabItem>()
  for (const it of [...server.items, ...local.items]) {
    const prev = byLemma.get(it.lemma)
    byLemma.set(it.lemma, prev ? pickItem(prev, it) : it)
  }
  const entries = new Map<string, ArticleVocabEntry>()
  for (const e of [...(server.articleEntries ?? []), ...(local.articleEntries ?? [])]) {
    const key = `${e.articleId}\u0000${e.lemma}`
    const prev = entries.get(key)
    entries.set(key, prev ? pickEntry(prev, e) : e)
  }
  return applyTombstones({
    ...local,
    items: [...byLemma.values()],
    articleEntries: [...entries.values()],
    tombstones: mergeTombstones(server.tombstones, local.tombstones),
    sentenceTexts: { ...(server.sentenceTexts ?? {}), ...(local.sentenceTexts ?? {}) },
  })
}

/** 判断两份词库“内容是否一样”（用于合并后决定要不要回写服务端）。 */
export function librarySignature(library: VocabLibrary): string {
  const items = [...library.items]
    .map((it) => `${it.id}\u0000${it.lemma}\u0000${it.updatedAt}`)
    .sort()
    .join('\n')
  const entries = [...(library.articleEntries ?? [])]
    .map((e) => `${e.articleId}\u0000${e.lemma}\u0000${e.addedAt}`)
    .sort()
    .join('\n')
  const tombs = [...(library.tombstones ?? [])]
    .map((t) => `${t.key}\u0000${t.at}`)
    .sort()
    .join('\n')
  const sentences = Object.keys(library.sentenceTexts ?? {}).sort().join('\n')
  return `${items}\n--\n${entries}\n--\n${tombs}\n--\n${sentences}`
}

export function sameLibrary(a: VocabLibrary, b: VocabLibrary): boolean {
  return librarySignature(a) === librarySignature(b)
}
