/**
 * 词库的老数据兼容 / 迁移**唯一收口**。
 *
 * 以前这些散落在加载路径上：`dedupeLibrary` → `normalizeGrammarMarks` → `repairLanguageKinds`，
 * 各自还带一点「缺字段怎么办」的临时判断；时间一长没人知道总共迁过什么。
 * 现在：**新老字段差异、兼容、去重、清洗全在这里**，加载只调一次 `migrateLibrary`。
 *
 * 约定：
 *   - 只做「补默认值 / 归一 / 去重 / 丢弃无法修复的条目」，**绝不删用户的正常数据**；
 *   - 迁移必须**幂等**（跑两遍结果一样）；
 *   - 破坏性变更要升 `SCHEMA_VERSION`，在老版本上先补一个 `migrateVnToVn+1`。
 */
import type {
  ArticleVocabEntry,
  VocabItem,
  VocabKind,
  VocabLibrary,
  VocabMeaningSource,
  VocabOrigin,
} from '../types/document'
import { hydrateSentenceTexts } from './vocab/sentenceTexts'
import { SCHEMA_VERSION, defaultReviewState } from '../types/document'
import { KIND_ORDER } from './entryKind'
import { cleanGloss, dedupeLibrary, normalizeGrammarMarks } from './vocab'
import { repairLanguageKinds } from './langPoints'
import { isVocabConfusableSource } from './vocabConfusables'
import { normalizeVocabFieldSources } from './vocabFields'
import { isVocabVia } from './vocabVia'

const KINDS = new Set<string>(KIND_ORDER)
const STATUSES = new Set(['unqueried', 'queried', 'edited', 'mastered'])

const str = (v: unknown): string => (typeof v === 'string' ? v : '')
const strOrNull = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v : null)
const strArray = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [])
const iso = (v: unknown, fallback: string): string => {
  const s = str(v)
  return s && !Number.isNaN(Date.parse(s)) ? s : fallback
}

const ISO_ISH = /^\d{4}-\d{2}-\d{2}T/

/**
 * 已经是当前结构的条目：**原样返回引用**。
 *
 * 为什么在意这点：加载路径会用「条目引用有没有变」判断要不要写库。
 * 如果这里每次都重建对象，就会**每打开一次页面白写一次词库**（还顺带追加快照）。
 */
function looksCurrent(o: Record<string, unknown>): boolean {
  const rs = (o.reviewState ?? {}) as Record<string, unknown>
  return (
    typeof o.id === 'string' &&
    !!o.id &&
    typeof o.word === 'string' &&
    !!o.word.trim() &&
    typeof o.lemma === 'string' &&
    !!o.lemma.trim() &&
    (o.kind === undefined || (typeof o.kind === 'string' && KINDS.has(o.kind))) &&
    typeof o.status === 'string' &&
    STATUSES.has(o.status) &&
    Array.isArray(o.examples) &&
    Array.isArray(o.usage) &&
    typeof o.createdAt === 'string' &&
    ISO_ISH.test(o.createdAt) &&
    typeof o.updatedAt === 'string' &&
    ISO_ISH.test(o.updatedAt) &&
    typeof rs.ease === 'number' &&
    typeof rs.interval === 'number' &&
    typeof rs.repetitions === 'number' &&
    (rs.relearn === undefined || (typeof rs.relearn === 'number' && rs.relearn >= 0)) &&
    (rs.meaningPasses === undefined || (typeof rs.meaningPasses === 'number' && rs.meaningPasses >= 0)) &&
    (rs.due === null || typeof rs.due === 'string' || rs.due === undefined)
  )
}

/** 把一条（可能来自老版本 / 手改过的 JSON 的）记录洗成合法词条；修不出来就返回 null。 */
function migrateItem(raw: unknown, now: string): VocabItem | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  if (looksCurrent(o)) return raw as VocabItem // 已是当前结构：保住引用，别让加载路径白写库
  const word = str(o.word).trim()
  const lemma = str(o.lemma).trim() || word.toLowerCase()
  if (!word || !lemma) return null

  const kind = typeof o.kind === 'string' && KINDS.has(o.kind) ? (o.kind as VocabKind) : undefined
  const status = typeof o.status === 'string' && STATUSES.has(o.status)
    ? (o.status as VocabItem['status'])
    : o.meaning
      ? 'queried'
      : 'unqueried'
  const rs = (o.reviewState ?? {}) as Record<string, unknown>
  const due = strOrNull(rs.due)

  return {
    id: str(o.id).trim() || `vocab:${lemma}`,
    word,
    lemma,
    kind,
    langPointId: typeof o.langPointId === 'string' ? o.langPointId : undefined,
    phonetic: strOrNull(o.phonetic),
    partOfSpeech: strOrNull(o.partOfSpeech),
    meaning: cleanGloss(str(o.meaning)) || null,
    grammarMarks: Array.isArray(o.grammarMarks) ? strArray(o.grammarMarks) : undefined,
    definition: cleanGloss(str(o.definition)) || null,
    fieldSources: normalizeVocabFieldSources(o.fieldSources),
    usage: strArray(o.usage),
    phrases: Array.isArray(o.phrases) ? strArray(o.phrases) : undefined,
    idioms: Array.isArray(o.idioms) ? strArray(o.idioms) : undefined,
    examples: (Array.isArray(o.examples) ? o.examples : []).flatMap((e) => {
      const ex = (e ?? {}) as Record<string, unknown>
      const text = str(ex.text).trim()
      if (!text) return []
      return [
        {
          text,
          translation: strOrNull(ex.translation) ?? undefined,
          articleId: strOrNull(ex.articleId) ?? undefined,
          fileName: strOrNull(ex.fileName) ?? undefined,
          sentenceId: strOrNull(ex.sentenceId) ?? undefined,
          origin: (['article', 'ai', 'tatoeba'] as const).includes(ex.origin as never) ? (ex.origin as never) : undefined,
        },
      ]
    }),
    source: (() => {
      const s = (o.source ?? null) as Record<string, unknown> | null
      if (!s || typeof s !== 'object') return null
      const articleId = str(s.articleId).trim()
      if (!articleId) return null
      return {
        articleId,
        fileName: strOrNull(s.fileName),
        sentenceId: strOrNull(s.sentenceId),
        sentenceText: str(s.sentenceText),
      }
    })(),
    contexts: (Array.isArray(o.contexts) ? o.contexts : []).flatMap((c) => {
      const cc = (c ?? {}) as Record<string, unknown>
      const articleId = str(cc.articleId).trim()
      if (!articleId) return []
      return [
        {
          articleId,
          fileName: strOrNull(cc.fileName),
          sentenceId: strOrNull(cc.sentenceId),
          sentenceText: str(cc.sentenceText),
          meaning: strOrNull(cc.meaning) ?? undefined,
          at: iso(cc.at, now),
        },
      ]
    }),
    status,
    note: str(o.note),
    tags: strArray(o.tags),
    lastPrintedAt: strOrNull(o.lastPrintedAt),
    confusables: Array.isArray(o.confusables)
      ? (o.confusables as unknown[]).flatMap((c) => {
          const cc = (c ?? {}) as Record<string, unknown>
          const w = str(cc.word).trim()
          return w ? [{ word: w, meaning: strOrNull(cc.meaning) ?? undefined }] : []
        })
      : undefined,
    confusablesSource: isVocabConfusableSource(o.confusablesSource) ? o.confusablesSource : undefined,
    priorityUntil: strOrNull(o.priorityUntil),
    reviewState: {
      ease: typeof rs.ease === 'number' && rs.ease > 0 ? rs.ease : 2.5,
      due,
      interval: typeof rs.interval === 'number' && rs.interval >= 0 ? rs.interval : 0,
      repetitions: typeof rs.repetitions === 'number' && rs.repetitions >= 0 ? rs.repetitions : 0,
      lapses: typeof rs.lapses === 'number' && rs.lapses >= 0 ? rs.lapses : undefined,
      relearn: typeof rs.relearn === 'number' && rs.relearn > 0 ? rs.relearn : undefined,
      // 「没看答案就选对释义」的次数：老数据没有，按 0（首次选对只判模糊）
      meaningPasses:
        typeof rs.meaningPasses === 'number' && rs.meaningPasses > 0 ? rs.meaningPasses : undefined,
    },
    createdAt: iso(o.createdAt, now),
    updatedAt: iso(o.updatedAt, now),
  }
}

/**
 * 逐条清洗「按篇收录表」。显式存在的条目保留引用（都合法时），
 * 只丢掉找不到词条 / 重复的脏记录；语言点条目保留（它们不参与编号）。
 */
function looksCurrentEntry(o: Record<string, unknown>): boolean {
  return (
    typeof o.articleId === 'string' &&
    !!o.articleId.trim() &&
    typeof o.lemma === 'string' &&
    !!o.lemma.trim() &&
    (o.origin === 'auto' || o.origin === 'manual') &&
    (o.via === undefined || isVocabVia(o.via)) &&
    typeof o.addedAt === 'string' &&
    ISO_ISH.test(o.addedAt) &&
    (o.sentenceId === undefined || o.sentenceId === null || typeof o.sentenceId === 'string') &&
    (o.sentenceText === undefined || typeof o.sentenceText === 'string') &&
    (o.meaning === undefined || o.meaning === null || typeof o.meaning === 'string') &&
    (o.meaningSource === undefined ||
      ['manual', 'context', 'library', 'dict', 'ai'].includes(String(o.meaningSource))) &&
    (o.printedAt === undefined || o.printedAt === null || typeof o.printedAt === 'string')
  )
}

function migrateEntry(raw: unknown, items: Map<string, VocabItem>, now: string): ArticleVocabEntry | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  const articleId = str(o.articleId).trim()
  const lemma = str(o.lemma).trim()
  if (!articleId || !lemma) return null
  const item = items.get(lemma)
  if (!item) return null
  const origin: VocabOrigin = o.origin === 'auto' ? 'auto' : 'manual'
  const via = isVocabVia(o.via) ? o.via : undefined
  const meaningSource = ['manual', 'context', 'library', 'dict', 'ai'].includes(String(o.meaningSource))
    ? (o.meaningSource as VocabMeaningSource)
    : undefined
  return {
    articleId,
    lemma,
    origin,
    via,
    addedAt: iso(o.addedAt, now),
    sentenceId: strOrNull(o.sentenceId),
    sentenceText: str(o.sentenceText),
    meaning: strOrNull(o.meaning),
    meaningSource,
    printedAt: strOrNull(o.printedAt),
  }
}

/** 老数据没有按篇表：只从能证明「在这一篇标过」的来源/语境补，绝不按正文出现推。 */
function deriveLegacyEntries(items: VocabItem[], now: string): ArticleVocabEntry[] {
  const derived: ArticleVocabEntry[] = []
  for (const it of items) {
    if (it.status === 'mastered') continue
    const byArticle = new Map<string, ArticleVocabEntry>()

    const sourceArticle = it.source?.fileName?.trim()
    if (sourceArticle) {
      byArticle.set(sourceArticle, {
        articleId: sourceArticle,
        lemma: it.lemma,
        origin: 'manual',
        via: 'legacy',
        addedAt: it.createdAt || now,
        sentenceId: it.source?.sentenceId ?? null,
        sentenceText: it.source?.sentenceText ?? '',
        meaning: null,
        meaningSource: undefined,
        printedAt: it.lastPrintedAt ?? null,
      })
    }

    for (const c of it.contexts ?? []) {
      const articleId = c.fileName?.trim()
      if (!articleId) continue
      const prev = byArticle.get(articleId)
      if (prev) {
        if (!prev.sentenceId && c.sentenceId) prev.sentenceId = c.sentenceId
        if (!prev.sentenceText && c.sentenceText) prev.sentenceText = c.sentenceText
        if (!prev.meaning && c.meaning?.trim()) {
          prev.meaning = c.meaning.trim()
          prev.meaningSource = 'context'
        }
        continue
      }
      byArticle.set(articleId, {
        articleId,
        lemma: it.lemma,
        origin: 'manual',
        via: 'legacy',
        addedAt: iso(c.at, now),
        sentenceId: c.sentenceId,
        sentenceText: c.sentenceText,
        meaning: strOrNull(c.meaning),
        meaningSource: c.meaning?.trim() ? 'context' : undefined,
        printedAt: it.lastPrintedAt ?? null,
      })
    }

    derived.push(...byArticle.values())
  }
  // 加入时间升序；同一时刻按词条顺序稳定
  return derived
    .map((e, i) => ({ e, i }))
    .sort((a, b) => a.e.addedAt.localeCompare(b.e.addedAt) || a.i - b.i)
    .map((x) => x.e)
}

function migrateArticleEntries(
  raw: unknown,
  items: VocabItem[],
  now: string,
): ArticleVocabEntry[] {
  const byLemma = new Map(items.map((it) => [it.lemma, it]))
  if (!Array.isArray(raw)) return deriveLegacyEntries(items, now)

  // 已经全是合法条目 → 保住原数组引用，避免每次加载都白写一次库
  const allCurrent = raw.every((e) => e && typeof e === 'object' && looksCurrentEntry(e as Record<string, unknown>))
  const migrated = raw.flatMap((e) => {
    const m = migrateEntry(e, byLemma, now)
    return m ? [m] : []
  })
  if (allCurrent && migrated.length === raw.length) {
    const seen = new Set<string>()
    let dup = false
    for (const e of migrated) {
      const k = `${e.articleId}\u0000${e.lemma}`
      if (seen.has(k)) dup = true
      seen.add(k)
    }
    if (!dup) return raw as ArticleVocabEntry[]
  }

  const seen = new Set<string>()
  return migrated.filter((e) => {
    const k = `${e.articleId}\u0000${e.lemma}`
    if (seen.has(k)) return false
    seen.add(k)
    return true
  })
}

/**
 * 把任意（老版本的 / 手改过的 / 半坏的）词库迁成当前结构：
 * 逐条洗 → 早先版本误标的类型修正 → 按词性过滤语法标记 → 按 lemma 去重。
 * **幂等**：已经是当前结构的库，跑完内容和原样一致（引用都会尽量复用）。
 */
export function migrateLibrary(raw: unknown, now: Date = new Date()): VocabLibrary {
  if (!raw || typeof raw !== 'object') return { schemaVersion: SCHEMA_VERSION, items: [], articleEntries: [] }
  const o = raw as Record<string, unknown>
  const list = Array.isArray(o.items) ? o.items : []
  const at = now.toISOString()
  const items = list.flatMap((it) => {
    const migrated = migrateItem(it, at)
    return migrated ? [migrated] : []
  })
  const articleEntries = migrateArticleEntries(o.articleEntries, items, at)
  const sentenceTexts =
    o.sentenceTexts && typeof o.sentenceTexts === 'object'
      ? (o.sentenceTexts as Record<string, string>)
      : undefined
  const library: VocabLibrary = {
    schemaVersion: SCHEMA_VERSION,
    items,
    articleEntries,
    ...(sentenceTexts ? { sentenceTexts } : {}),
  }
  // 先修类型/旧键，再按 lemma 去重：否则旧 usage 笔记的坏键会和同名真单词合并，
  // 修完键之后才去重才能把「笔记」和「单词」分开。
  const normalized = normalizeGrammarMarks(dedupeLibrary(repairLanguageKinds(library)))
  return hydrateSentenceTexts(normalized)
}

/** 老版本 → 当前版本要做的破坏性兼容都写在这里（现在只有 v1，占位给未来）。 */
export function migrateToCurrent(library: VocabLibrary): VocabLibrary {
  if (library.schemaVersion === SCHEMA_VERSION) return library
  // 未来：case 0: return migrateV0ToV1(library) …
  return { ...library, schemaVersion: SCHEMA_VERSION }
}

/** 只给测试/文档用：当前的复习状态默认值（避免各处重复 new 一份）。 */
export function defaultReviewStateForTest() {
  return defaultReviewState()
}
