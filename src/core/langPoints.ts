/**
 * 语言点收藏（词组 / 习语 / 用法笔记）——**自己的领域模块**。
 *
 * 为什么从 vocab.ts 里拆出来：`vocab.ts` 是「单词」的规则层（查词、复习排期、打印分组），
 * 而语言点是从 `SentenceLanguage` 自动收进来的另一类条目（键规则、幂等、来源记账都不同）。
 * 混在一起会让两边都难改。这里只依赖：
 *   - `entryKind`（类型判断，零依赖）
 *   - `vocab` 的**通用**小工具（去重语境、合并例句、lemma 归一）——单向依赖，vocab 不反向引这里
 *
 * 存储上仍与单词共用一份词库（`VocabItem.kind` 区分），好处是打印/导出/按篇按日期/未打印
 * 这些选项**整套复用**；显示层则按类型分开渲染（见 reader 的 `LangPointList`）。
 */
import type { Sentence, VocabContext, VocabExample, VocabItem, VocabKind, VocabLibrary, VocabSource } from '../types/document'
import { defaultReviewState } from '../types/document'
import { kindOf } from './entryKind'
import { addArticleEntry } from './articleVocab'
import { betterSource, contextFromSource, lemmaOf, normalizeWord, upsertContext } from './vocab'
import { getSentenceLanguages } from './language'

/**
 * 「任意文本」的去重键：保留中文（中文用法笔记用得上），统一大小写、撇号与空白。
 * 英文单词请用 `lemmaOf`。
 */
export function textKey(raw: string): string {
  return raw
    .normalize('NFKC')
    .replace(/[\u2018\u2019\u02bc\u2032]/g, "'")
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
}

/** 一条待收藏的语言点（从句子语言点里抽出来的中间结构）。 */
export interface LanguagePoint {
  kind: VocabKind
  /** 词条正文（词组/习语是英文原文；用法笔记是中文说明） */
  word: string
  /** 中文释义（词组 / 习语有；用法笔记没有） */
  gloss?: string
  /** 出自哪篇文章的哪一句 */
  source: VocabSource
}

/**
 * 从一批句子的语言点里抽出可**收藏**的条目（词组 / 习语 / 用法笔记），带来源句。
 * 词组/习语的写法是「英文 — 简短中文」，这里顺手拆成 词条 + 释义。
 */
export function languagePointsOf(
  sentences: Pick<Sentence, 'id' | 'text' | 'language' | 'languages'>[] | null | undefined,
  article: { articleId: string; fileName?: string | null },
): LanguagePoint[] {
  if (!sentences?.length) return []
  const out: LanguagePoint[] = []
  const fileName = article.fileName ?? null
  const push = (kind: LanguagePoint['kind'], raw: string, split: boolean, source: Pick<Sentence, 'id' | 'text'>) => {
    const text = raw.trim()
    if (!text) return
    const { word, gloss } = split ? splitGlossText(text) : { word: text, gloss: undefined }
    if (!word.trim()) return
    out.push({
      kind,
      word: word.trim(),
      gloss: gloss?.trim() || undefined,
      source: { articleId: article.articleId, fileName, sentenceId: source.id, sentenceText: source.text },
    })
  }
  for (const s of sentences) {
    for (const L of getSentenceLanguages(s)) {
      for (const p of L.phrases ?? []) push('phrase', p, true, s)
      for (const i of L.idioms ?? []) push('idiom', i, true, s)
      // 用法是中文说明，不拆「英文 — 中文」（否则会把中文当成词条）
      for (const u of L.usage ?? []) push('usage', u, false, s)
    }
  }
  return out
}

/** 把「英文 — 中文」拆成 `{ word, gloss }`（也认 – / - 破折号）。 */
export function splitGlossText(raw: string): { word: string; gloss?: string } {
  const s = raw.trim()
  const parts = s.split(/\s+[—–-]\s+/)
  if (parts.length >= 2) {
    const word = parts[0].trim()
    const gloss = parts.slice(1).join(' — ').trim()
    if (word) return { word, gloss: gloss || undefined }
  }
  return { word: s }
}

/**
 * 一条语言点在词库里的**键与类型**：
 *   - 用法笔记 / 没有英文的说明 → 整条文本当键，类型 `usage`（不与单词、词组撞车）；
 *   - 单个英文单词（AI 偶尔把单词写进「词组」栏）→ 当普通单词（走查词与词形归并）；
 *   - 其余（真词组 / 习语）→ 按原形当键，类型照旧。
 */
export function langPointKeyAndKind(p: LanguagePoint): { key: string; kind?: VocabKind } {
  const english = normalizeWord(p.word)
  const isNote = p.kind === 'usage' || !english
  if (isNote) return { key: textKey(p.word), kind: 'usage' }
  if (!english.includes(' ')) return { key: lemmaOf(p.word) || textKey(p.word) }
  return { key: lemmaOf(p.word) || textKey(p.word), kind: p.kind }
}

/** 这条语言点的稳定身份（同一篇、同一句、同一段文字只收一次）。 */
export function langPointIdOf(p: LanguagePoint): string {
  const { kind } = langPointKeyAndKind(p)
  const file = p.source.fileName ?? p.source.articleId
  return `${kind ?? 'word'}|${file}|${p.source.sentenceId ?? ''}|${textKey(p.word)}`
}

/** 一篇文章的语言点内容签名（内容变了才需要重收）。 */
export function langPointSignature(points: LanguagePoint[]): Record<string, string> {
  const byArticle = new Map<string, string[]>()
  for (const p of points) {
    const id = p.source.fileName ?? p.source.articleId
    const line = `${p.kind}|${p.word}|${p.source.sentenceId ?? ''}|${p.gloss ?? ''}`
    const list = byArticle.get(id)
    if (list) list.push(line)
    else byArticle.set(id, [line])
  }
  return Object.fromEntries([...byArticle.entries()].map(([id, list]) => [id, list.sort().join('\u0001')]))
}

function mergeExamples(a: VocabExample[], b: VocabExample[]): VocabExample[] {
  const out = [...a]
  for (const e of b) {
    const key = (x: VocabExample) => x.sentenceId ?? `${x.text}`
    if (!out.some((x) => key(x) === key(e))) out.push(e)
  }
  return out
}

function sourceHasText(s: VocabSource | null | undefined): boolean {
  return !!s && (!!s.sentenceText?.trim() || !!s.sentenceId)
}

/** 一条语言点造出的语境与例句。 */
function pointContextAndExample(p: LanguagePoint, word: string, gloss: string | null, iso: string) {
  const context: VocabContext = contextFromSource(p.source, iso, gloss ?? undefined)
  const example: VocabExample = {
    text: p.source.sentenceText?.trim() || word,
    articleId: p.source.articleId,
    fileName: p.source.fileName ?? undefined,
    sentenceId: p.source.sentenceId ?? undefined,
    origin: 'article',
  }
  return { context, example }
}

/**
 * 把语言点批量收进词库（**幂等**）：
 *   - 先按 `langPointId`（收藏标记）找，找不到再按键/原形找；
 *   - 已有的只补语境、释义、类型与例句，绝不重复建条；一次建索引、单趟处理。
 *
 * 幂等很关键：调用方可能在每次「词库/文章」变动时调用它。
 * 词形被别的逻辑改写（如词典归并）也不会导致重复收——见 `langPointId`。
 */
export function upsertLanguagePoints(
  library: VocabLibrary,
  points: LanguagePoint[],
  now: Date = new Date(),
): VocabLibrary {
  if (!points.length) return library
  const iso = now.toISOString()
  const byLemma = new Map<string, number>()
  const byId = new Map<string, number>()
  library.items.forEach((it, i) => {
    if (!byLemma.has(it.lemma)) byLemma.set(it.lemma, i)
    if (it.langPointId && !byId.has(it.langPointId)) byId.set(it.langPointId, i)
  })
  const items = [...library.items]
  let changed = false
  const collectedPoints: { point: LanguagePoint; key: string; gloss: string | null }[] = []

  for (const p of points) {
    const word = p.word.trim()
    if (!word) continue
    const { key, kind } = langPointKeyAndKind(p)
    if (!key) continue
    const pointId = langPointIdOf(p)
    const gloss = p.gloss?.trim() || null
    collectedPoints.push({ point: p, key, gloss })
    const { context, example } = pointContextAndExample(p, word, gloss, iso)
    const at = byId.get(pointId) ?? byLemma.get(key)

    if (at === undefined) {
      items.push({
        id: `vocab:${key}`,
        word,
        lemma: key,
        kind,
        langPointId: pointId,
        phonetic: null,
        partOfSpeech: null,
        meaning: gloss,
        usage: [],
        examples: [example],
        source: p.source,
        status: 'queried', // 语言点自带释义，没有「待查」这一步
        note: '',
        tags: [],
        contexts: [context],
        reviewState: defaultReviewState(),
        createdAt: iso,
        updatedAt: iso,
      })
      byLemma.set(key, items.length - 1)
      byId.set(pointId, items.length - 1)
      changed = true
      continue
    }

    const cur = items[at]
    const contexts = upsertContext(cur.contexts, context)
    // 释义：语言点自己收进来的条目（带 langPointId）允许随 AI 重跑更新；
    // 手动改过（edited/mastered）的不动；普通单词条目的释义绝不覆盖（词典/用户优先）
    const locked = cur.status === 'edited' || cur.status === 'mastered'
    const mine = cur.langPointId !== undefined
    const meaning = locked ? cur.meaning : mine && gloss ? gloss : cur.meaning ?? gloss
    // 已存在就不改类型（单词被 AI 误列为词组时不误标）
    const nextKind = cur.kind ?? kind
    const merged = mergeExamples(cur.examples, [example])
    const examples = merged.length === cur.examples.length ? cur.examples : merged
    if (
      contexts === cur.contexts &&
      meaning === cur.meaning &&
      nextKind === cur.kind &&
      examples === cur.examples &&
      cur.langPointId !== undefined && // 还没打标记 → 这次要补上
      sourceHasText(cur.source)
    ) {
      continue
    }
    items[at] = {
      ...cur,
      kind: nextKind,
      langPointId: cur.langPointId ?? pointId,
      meaning,
      contexts,
      examples,
      source: betterSource(cur.source, p.source),
      updatedAt: iso,
    }
    changed = true
  }

  let out = changed ? { ...library, items } : library
  // 语言点也要有「按篇归属」：否则侧栏语言点页签 / 按篇打印看不到它们。
  // 它们照常不参与正文编号（`articleNums` 只看单词）。
  for (const { point, key, gloss } of collectedPoints) {
    const articleId = point.source?.fileName?.trim() || point.source?.articleId?.trim() || ''
    if (!articleId) continue
    out = addArticleEntry(
      out,
      {
        articleId,
        lemma: key,
        origin: 'auto',
        via: 'language',
        sentenceId: point.source?.sentenceId ?? null,
        sentenceText: point.source?.sentenceText ?? '',
        meaning: gloss,
        meaningSource: gloss ? 'context' : undefined,
      },
      now,
    )
  }
  return out
}

/**
 * 一次性修正（加载时跑，幂等）：早期版本把「用法笔记」的键取成了笔记里那个英文单词，
 * 于是把**真正的单词词条**误标成了「用法」（不进背单词/考试），也可能把单词标成「词组」。
 *
 * 判据：有 `kind` 却没有 `langPointId`（新代码收进来的条目一定带标记）。
 */
export function repairLanguageKinds(library: VocabLibrary): VocabLibrary {
  const hasCJK = /[\u3400-\u9fff\u3040-\u30ff\uac00-\ud7af]/
  let changed = false
  /** 旧用法笔记的坏键（`mantra`）→ 修好的整条笔记键；按篇条目也要跟着改名。 */
  const renames = new Map<string, { key: string; sentenceId: string | null }[]>()
  const items = library.items.map((it) => {
    const k = kindOf(it)
    if (k === 'word' || it.langPointId) return it
    const english = normalizeWord(it.word)

    if (k === 'usage') {
      // 旧版把「用法笔记」的键取成笔记里的英文单词（如 `mantra`），
      // 导致同名单词被这条 usage 占住、手动加词永远被合并成「用法」。
      // 真笔记（含中文）改用整条文本做键；纯英文的伪 usage 才退回单词。
      if (!hasCJK.test(it.word)) {
        changed = true
        const next = { ...it }
        delete next.kind
        return next
      }
      const key = textKey(it.word)
      if (key && it.lemma !== key) {
        changed = true
        const list = renames.get(it.lemma) ?? []
        list.push({ key, sentenceId: it.source?.sentenceId ?? null })
        renames.set(it.lemma, list)
        return { ...it, id: `vocab:${key}`, lemma: key }
      }
      return it
    }

    if (!english.includes(' ')) {
      changed = true
      const next = { ...it }
      delete next.kind
      return next
    }
    return it
  })
  if (!changed) return library

  let articleEntries = library.articleEntries
  if (articleEntries?.length && renames.size) {
    // 同名单词已经存在时，按篇条目更可能指的是那个单词（旧数据无法区分），
    // 不要把它改挂到用法笔记上；只给「没有同名单词」的笔记改名。
    const wordKeys = new Set(
      library.items.filter((it) => kindOf(it) === 'word' || (kindOf(it) !== 'usage' && !normalizeWord(it.word).includes(' '))).map((it) => it.lemma),
    )
    articleEntries = articleEntries.map((e) => {
      if (wordKeys.has(e.lemma)) return e
      const candidates = renames.get(e.lemma)
      if (!candidates?.length) return e
      const hit = candidates.find((c) => c.sentenceId && c.sentenceId === e.sentenceId) ?? candidates[0]
      return { ...e, lemma: hit.key }
    })
  }
  return { ...library, items, ...(articleEntries ? { articleEntries } : {}) }
}

/** 视图用：把语言点按「词组 / 习语 / 用法」分好组（空组不返回）。 */
export function groupLangPoints(items: VocabItem[]): { kind: VocabKind; items: VocabItem[] }[] {
  const out: { kind: VocabKind; items: VocabItem[] }[] = []
  for (const kind of ['phrase', 'idiom', 'usage'] as VocabKind[]) {
    const list = items.filter((it) => kindOf(it) === kind)
    if (list.length) out.push({ kind, items: list })
  }
  return out
}
