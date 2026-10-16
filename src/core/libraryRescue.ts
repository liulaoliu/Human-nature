/**
 * 词库**救援**：从本机其它记录里把词条捞回来。
 *
 * 场景：词库被误清 / 读失败事故后，词没了，但本机还留着这些痕迹：
 *   - `reader:batch`：各篇文章的「待选词」清单（词 + 所在句，最有价值）
 *   - `reader:mistakes`：错题本（词条 id 形如 `vocab:run`，还有显示标签）
 * 用它们重新建词条（词形 + 来源句；释义可以之后用离线词典/AI 补，本地 `补齐生词本` 即可）。
 *
 * 纯函数：给同样的记录总是同样的结果，调用方只管读记录、写词库。
 */
import type { VocabLibrary } from '../types/document'
import { markWord } from './vocab'
import { rebuildFromArticleMarks, type ArticleWithMarks } from './libraryFromArticles'

/** 从本机读出来的救援素材。 */
export interface RescueRecords {
  /** 待选清单：文章标识 → 条目（词 + 所在句） */
  batch?: Record<string, { word: string; sentence?: string; sentenceId?: string | null }[]>
  /** 错题本里出现的词（显示标签） */
  mistakeWords?: string[]
}

export interface RescueResult {
  library: VocabLibrary
  /** 这次补回来多少条（已存在的算「找到但没新加」） */
  added: number
  /** 素材里一共认出多少个不同的词 */
  found: number
}

/** 从 `vocab:xxx` 这种 id 里抠出 lemma（错题本只有 id 时用）。 */
function lemmaFromItemId(id: string): string {
  return id.startsWith('vocab:') ? id.slice('vocab:'.length) : ''
}

/** 把救援素材里的词条并回词库（幂等：已有的不重复建）。 */
export function rescueLibrary(library: VocabLibrary, records: RescueRecords, now: Date = new Date()): RescueResult {
  const seen = new Set<string>()
  const entries: { word: string; sentence?: string; sentenceId?: string | null; articleId: string }[] = []

  for (const [articleId, list] of Object.entries(records.batch ?? {})) {
    for (const b of list ?? []) {
      const word = (b.word ?? '').trim()
      if (!word) continue
      const key = word.toLowerCase()
      if (seen.has(key)) continue
      seen.add(key)
      entries.push({ word, sentence: b.sentence, sentenceId: b.sentenceId ?? null, articleId })
    }
  }
  for (const raw of records.mistakeWords ?? []) {
    const lemma = lemmaFromIdOrWord(raw)
    if (!lemma) continue
    const key = lemma.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    entries.push({ word: lemma, articleId: '（恢复自错题本）' })
  }

  let lib = library
  let added = 0
  for (const e of entries) {
    try {
      const r = markWord(
        lib,
        {
          word: e.word,
          articleId: e.articleId,
          fileName: e.articleId.startsWith('（') ? null : e.articleId,
          sentenceId: e.sentenceId ?? null,
          sentenceText: e.sentence ?? '',
        },
        now,
      )
      // 已经有了就不动它（幂等；也保住调用方「没变化就别写库」的判断）
      if (!r.created) continue
      lib = r.library
      added++
    } catch {      // 词形归一后为空之类的脏数据：跳过
    }
  }
  return { library: lib, added, found: entries.length }
}

/** 错题本条目可能是 `vocab:run` 或直接是词。 */
function lemmaFromIdOrWord(raw: string): string {
  const s = (raw ?? '').trim()
  if (!s) return ''
  const fromId = lemmaFromItemId(s)
  return fromId || s
}

/** 「一次全捞」的素材：正文标记（文章里的 Sentence.vocab）+ 本机其它记录（待选/错题本）。 */
export interface RecoverSources {
  articles?: ArticleWithMarks[]
  records?: RescueRecords
}

export interface RecoverResult {
  library: VocabLibrary
  added: number
  /** 各来源各认出多少（给提示用） */
  fromMarks: number
  fromRecords: number
}

/**
 * 一次把能捞的都捞回来（**只加不删、幂等**）。
 * 顺序无所谓（各自的键不同），但先收正文标记：那是最忠实的一份（当年真正标过的词 + 原句）。
 */
export function recoverLibrary(library: VocabLibrary, sources: RecoverSources, now: Date = new Date()): RecoverResult {
  let lib = library
  let added = 0
  let fromMarks = 0
  let fromRecords = 0
  if (sources.articles?.length) {
    const r = rebuildFromArticleMarks(lib, sources.articles, now)
    lib = r.library
    added += r.added
    fromMarks = r.found
  }
  if (sources.records) {
    const r = rescueLibrary(lib, sources.records, now)
    lib = r.library
    added += r.added
    fromRecords = r.found
  }
  return { library: lib, added, fromMarks, fromRecords }
}

/** 统计「本机记录」里能认出多少词（只数，不建条目）——给侧栏「先看数」用。 */
export function countRescueWords(records: RescueRecords): { batch: number; mistakes: number; total: number } {
  const inBatch = new Set<string>()
  for (const list of Object.values(records.batch ?? {})) {
    for (const b of list ?? []) {
      const w = (b?.word ?? '').trim()
      if (w) inBatch.add(w.toLowerCase())
    }
  }
  const inMistakes = new Set<string>()
  for (const raw of records.mistakeWords ?? []) {
    const w = (raw ?? '').trim()
    if (!w) continue
    const word = w.startsWith('vocab:') ? w.slice(6) : w
    if (word && !inBatch.has(word.toLowerCase())) inMistakes.add(word.toLowerCase())
  }
  return { batch: inBatch.size, mistakes: inMistakes.size, total: inBatch.size + inMistakes.size }
}
