import type { ArticleVocabEntry, VocabContext, VocabLibrary, VocabSource } from '../../types/document'

/**
 * 句子原文的共享存储。
 *
 * 为什么：同一个词条会同时被 `source`、`contexts`、`articleEntries` 引用同一句；
 * 每个引用各存一份原文，整库会多出几 MB（2026-10-24 盘点约 6MB）。
 * 落盘时收进 `library.sentenceTexts`（一句一份），读出来再补回各字段。
 *
 * 键 = `articleId || fileName` + NUL + `sentenceId`；没有 `sentenceId` 的引用不参与。
 */

type SentenceRef = Pick<VocabSource, 'articleId' | 'fileName' | 'sentenceId' | 'sentenceText'>
type MaybeRef = Partial<SentenceRef> | null | undefined

export function sentenceTextKey(ref: MaybeRef): string {
  if (!ref) return ''
  const sentenceId = String(ref.sentenceId ?? '').trim()
  if (!sentenceId) return ''
  const article = String(ref.articleId || ref.fileName || '').trim()
  return `${article}\u0000${sentenceId}`
}

function textOf(ref: MaybeRef): string {
  return typeof ref?.sentenceText === 'string' ? ref.sentenceText : ''
}

function isEmptyText(text: string): boolean {
  return !text.trim()
}

/** 收集全库所有句子原文；同一键文本不一致时记为冲突，冲突键保留各自原文、不进共享表。 */
function collect(library: VocabLibrary): { texts: Map<string, string>; conflicts: Set<string> } {
  const texts = new Map<string, string>()
  const conflicts = new Set<string>()
  const add = (ref: MaybeRef) => {
    const key = sentenceTextKey(ref)
    const text = textOf(ref)
    if (!key || isEmptyText(text)) return
    const prev = texts.get(key)
    if (prev !== undefined && prev !== text) {
      conflicts.add(key)
      return
    }
    texts.set(key, text)
  }

  for (const [key, text] of Object.entries(library.sentenceTexts ?? {})) {
    if (!key || typeof text !== 'string' || isEmptyText(text)) continue
    const prev = texts.get(key)
    if (prev !== undefined && prev !== text) conflicts.add(key)
    else texts.set(key, text)
  }
  for (const item of library.items) {
    add(item.source)
    for (const ctx of item.contexts ?? []) add(ctx)
  }
  for (const entry of library.articleEntries ?? []) add(entry)
  for (const key of conflicts) texts.delete(key)
  return { texts, conflicts }
}

function referencedKeys(library: VocabLibrary): Set<string> {
  const keys = new Set<string>()
  const add = (ref: MaybeRef) => {
    const key = sentenceTextKey(ref)
    if (key) keys.add(key)
  }
  for (const item of library.items) {
    add(item.source)
    for (const ctx of item.contexts ?? []) add(ctx)
  }
  for (const entry of library.articleEntries ?? []) add(entry)
  return keys
}

/**
 * 落盘前调用：把能共享的原文收进 `sentenceTexts`，并把各引用里的原文清空。
 *
 * 冲突（同键不同句）不共享，避免读回时把 A 句塞给 B 引用。
 * 没有任何可共享内容时返回原对象（保住引用，别让加载路径误判“有脏数据”）。
 */
export function compactSentenceTexts(library: VocabLibrary): VocabLibrary {
  const { texts, conflicts } = collect(library)
  const referenced = referencedKeys(library)
  for (const key of [...texts.keys()]) {
    if (!referenced.has(key)) texts.delete(key)
  }
  if (!texts.size) {
    // 没有可共享的句子：只清掉旧 map 里没人引用的键
    if (!library.sentenceTexts || Object.keys(library.sentenceTexts).length === 0) return library
    const next: VocabLibrary = { ...library }
    delete next.sentenceTexts
    return next
  }

  const strip = <T extends SentenceRef>(ref: T | null): T | null => {
    const key = sentenceTextKey(ref)
    if (!ref || !key || conflicts.has(key) || !texts.has(key)) return ref
    if (isEmptyText(textOf(ref))) return ref
    return { ...ref, sentenceText: '' }
  }

  const items = library.items.map((item) => {
    const source = strip(item.source)
    const contexts = item.contexts?.map((ctx) => strip(ctx) as VocabContext)
    if (source === item.source && contexts === item.contexts) return item
    return { ...item, source, contexts }
  })
  const articleEntries = library.articleEntries?.map((entry) => {
    const next = strip(entry as unknown as SentenceRef) as unknown as ArticleVocabEntry
    if (next === entry) return entry
    return next
  })

  return {
    ...library,
    items,
    ...(articleEntries ? { articleEntries } : {}),
    sentenceTexts: Object.fromEntries(texts),
  }
}

/**
 * 读出后调用：把共享表里的原文补回 `source` / `contexts` / `articleEntries`。
 * 已经有原文的引用不动；没有共享表时原样返回。
 */
export function hydrateSentenceTexts(library: VocabLibrary): VocabLibrary {
  const map = library.sentenceTexts
  if (!map || !Object.keys(map).length) return library
  let changed = false
  const fill = <T extends SentenceRef>(ref: T | null): T | null => {
    if (!ref) return ref
    if (!isEmptyText(textOf(ref))) return ref
    const text = map[sentenceTextKey(ref)]
    if (!text) return ref
    changed = true
    return { ...ref, sentenceText: text }
  }

  const items = library.items.map((item) => {
    const source = fill(item.source)
    const contexts = item.contexts?.map((ctx) => fill(ctx) as VocabContext)
    if (source === item.source && contexts === item.contexts) return item
    return { ...item, source, contexts }
  })
  const articleEntries = library.articleEntries?.map(
    (entry) => fill(entry as unknown as SentenceRef) as unknown as ArticleVocabEntry,
  )
  if (articleEntries && articleEntries.some((e, i) => e !== library.articleEntries?.[i])) changed = true
  if (!changed) return library
  return { ...library, items, ...(articleEntries ? { articleEntries } : {}) }
}
