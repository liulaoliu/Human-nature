/**
 * 「这篇文章收了哪些生词」——按篇独立的收录层（纯函数）。
 *
 * 和全局 `VocabItem` 的分工：
 *   - `VocabItem`：这个词本身怎么背、释义、复习状态（全库一条，按 lemma 去重）；
 *   - `ArticleVocabEntry`：这一篇什么时候收的、第几号、自动还是手动、这篇打没打印。
 *
 * 为什么不能再用「正文里出现过 + 词库里有」来算本篇：
 * 那样每开一篇新文章，只要总词库里恰好有 the / is / are，就会自动变成本篇生词、
 * 带编号、进侧栏，用户并没有在这篇标过它们。本篇只认显式收录的条目。
 */
import type {
  ArticleVocabEntry,
  VocabItem,
  VocabLibrary,
  VocabMeaningSource,
  VocabOrigin,
  VocabVia,
} from '../types/document'
import { kindOf } from './entryKind'

export interface ArticleEntryView {
  entry: ArticleVocabEntry
  item: VocabItem
}

/** 词库里所有按篇条目（老数据没有该字段时为空）。 */
export function articleEntries(library: VocabLibrary): ArticleVocabEntry[] {
  return library.articleEntries ?? []
}

/** 某一篇的条目，保持加入顺序（编号 = 这个数组的下标 + 1）。 */
export function articleEntriesOf(library: VocabLibrary, articleId: string): ArticleVocabEntry[] {
  if (!articleId) return []
  return articleEntries(library).filter((e) => e.articleId === articleId)
}

/** 某一篇的 lemma → 条目。 */
export function articleEntryMap(library: VocabLibrary, articleId: string): Map<string, ArticleVocabEntry> {
  return new Map(articleEntriesOf(library, articleId).map((e) => [e.lemma, e]))
}

/**
 * 某一篇真正要显示的词条：按加入顺序、去掉已掌握 / 已被全库删掉的。
 * 默认只取普通单词（正文编号 / 复习用）；`includeLang = true` 时也包含
 * 词组 / 习语 / 用法（侧栏「语言点」页签要显示，但不参与正文编号）。
 * 重复 lemma（历史脏数据）只保留第一条，避免同一词出现两个编号。
 */
export function articleEntryViews(
  library: VocabLibrary,
  articleId: string,
  includeLang = false,
): ArticleEntryView[] {
  const byLemma = new Map(library.items.map((it) => [it.lemma, it]))
  const seen = new Set<string>()
  const out: ArticleEntryView[] = []
  for (const entry of articleEntriesOf(library, articleId)) {
    if (seen.has(entry.lemma)) continue
    const item = byLemma.get(entry.lemma)
    if (!item || item.status === 'mastered') continue
    if (!includeLang && kindOf(item) !== 'word') continue
    seen.add(entry.lemma)
    out.push({ entry, item })
  }
  return out
}

/** 某一篇要显示 / 复习 / 打印的词条（与 `articleEntryViews` 同序）。 */
export function articleItemsOf(library: VocabLibrary, articleId: string): VocabItem[] {
  return articleEntryViews(library, articleId).map((x) => x.item)
}

export interface AddArticleEntryInput {
  articleId: string
  lemma: string
  origin: VocabOrigin
  /** 细分来源（AI / 词典 / 手动 / 语言点）；旧调用不传就只显示粗粒度 origin */
  via?: VocabVia
  sentenceId?: string | null
  sentenceText?: string
  meaning?: string | null
  meaningSource?: VocabMeaningSource
}

/**
 * 收录一个词到某篇（单词 / 词组 / 习语 / 用法都可收，已掌握的不收）；
 * 已收过则只补空着的语境/释义，不改变加入顺序。
 */
export function addArticleEntry(
  library: VocabLibrary,
  input: AddArticleEntryInput,
  now: Date = new Date(),
): VocabLibrary {
  const articleId = input.articleId.trim()
  const lemma = input.lemma.trim()
  if (!articleId || !lemma) return library
  const item = library.items.find((it) => it.lemma === lemma)
  if (!item || item.status === 'mastered') return library

  const list = articleEntries(library)
  const idx = list.findIndex((e) => e.articleId === articleId && e.lemma === lemma)
  if (idx >= 0) {
    const prev = list[idx]
    const next: ArticleVocabEntry = {
      ...prev,
      // 旧条目没有 via 时，后来的动作可以补上；已有来源不覆盖（保留第一次收录方式）
      via: prev.via ?? input.via,
      sentenceId: prev.sentenceId ?? input.sentenceId ?? null,
      sentenceText: prev.sentenceText || input.sentenceText || '',
      meaning: prev.meaning || input.meaning || null,
      meaningSource: prev.meaningSource ?? input.meaningSource,
    }
    if (
      next.via === prev.via &&
      next.sentenceId === prev.sentenceId &&
      next.sentenceText === prev.sentenceText &&
      next.meaning === prev.meaning &&
      next.meaningSource === prev.meaningSource
    ) {
      return library
    }
    return { ...library, articleEntries: list.map((e, i) => (i === idx ? next : e)) }
  }

  const entry: ArticleVocabEntry = {
    articleId,
    lemma,
    origin: input.origin,
    via: input.via,
    addedAt: now.toISOString(),
    sentenceId: input.sentenceId ?? null,
    sentenceText: input.sentenceText ?? '',
    meaning: input.meaning ?? null,
    meaningSource: input.meaning ? input.meaningSource ?? 'manual' : undefined,
  }
  return { ...library, articleEntries: [...list, entry] }
}

/** 从某一篇移出（只删这篇的收录，不动全库词条，也不影响别的篇）。 */
export function removeArticleEntry(library: VocabLibrary, articleId: string, lemma: string): VocabLibrary {
  const list = articleEntries(library)
  const next = list.filter((e) => !(e.articleId === articleId && e.lemma === lemma))
  return next.length === list.length ? library : { ...library, articleEntries: next }
}

/** 记录「这一篇的这几个词打印过」；打印状态按篇独立，不污染别的篇。 */
export function markArticlePrinted(
  library: VocabLibrary,
  articleId: string,
  lemmas: Iterable<string>,
  now: Date = new Date(),
): VocabLibrary {
  const set = new Set(lemmas)
  if (!set.size) return library
  const iso = now.toISOString()
  const list = articleEntries(library)
  let changed = false
  const next = list.map((e) => {
    if (e.articleId !== articleId || !set.has(e.lemma)) return e
    changed = true
    return { ...e, printedAt: iso }
  })
  return changed ? { ...library, articleEntries: next } : library
}

/** 合并两套按篇条目（备份合并用）：同篇同 lemma 保留本机已有的顺序与字段。 */
export function mergeArticleEntries(
  current: ArticleVocabEntry[],
  incoming: ArticleVocabEntry[],
): ArticleVocabEntry[] {
  const seen = new Set(current.map((e) => `${e.articleId}\u0000${e.lemma}`))
  const out = [...current]
  for (const e of incoming) {
    const key = `${e.articleId}\u0000${e.lemma}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push(e)
  }
  return out
}
