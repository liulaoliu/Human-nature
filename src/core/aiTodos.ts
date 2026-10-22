/**
 * AI 待办的筛选与分块：从当前数据里挑出「还缺什么」，以及每批带多少条。
 *
 * 为什么单独一层：`buildAiJobs`（要提示词）和 `countAiJobs`（只要个数）必须用
 * **同一套筛选条件**，否则面板上的数量和实际导出的任务对不上。之前两份代码各写一遍
 * filter，改一处漏一处就会静默不一致；现在都从这里取。
 *
 * 只做筛选与切块，不拼提示词、不生成 id。
 */
import { isWordEntry } from './entryKind'
import { isMarkablePos, needsAiExamples, normalizeWord } from './vocab'
import type { VocabItem } from '../types/document'

const LOOKUP_CHUNK = 30
/** 翻译 / 语言点每次带多少句（一条太长会在网页端被截断）。 */
export const SENTENCE_CHUNK = 6
/** 单条任务最多带多少词（提示词过长会被网页端截断）。 */
const EXAMPLE_MAX = 30
const PHRASE_MAX = 30
const CONTEXT_MAX = 30
const LEMMA_MAX = 100
const POS_MAX = 60
const MARK_MAX = 30

/** 把数组切成每块最多 size 个（size<=0 表示不切）。 */
export function chunk<T>(items: T[], size: number): T[][] {
  if (size <= 0) return items.length ? [items] : []
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
  return out
}

/** 含 -ing / -ed 形式的词（用于语法辨析候选）。 */
function hasIngEd(s: string): boolean {
  return s.split(/\s+/).some((t) => /(ing|ed)$/i.test(t))
}

/** 待办的范围输入：本篇还是整库。 */
export interface AiScopeInput {
  scope: 'article' | 'all'
  /** 本篇的词（来源属于本文）。 */
  articleWords: VocabItem[]
  /** 整个词库。 */
  items: VocabItem[]
}

/** 本次任务要考虑的词条（词组/习语/用法笔记不参与词级任务）。 */
export function pickTodoBase(input: AiScopeInput): VocabItem[] {
  return (input.scope === 'article' ? input.articleWords : input.items).filter(isWordEntry)
}

/**
 * 生词本缺音标/释义 → 批量查词。只看「从未查过」的词：查过一次就不再自动重排，
 * 免得「模型只补了释义没给音标」这种半成品被无限重试；剩下的可离线「补齐生词本」。
 */
export function pickNeedInfo(base: VocabItem[]): VocabItem[] {
  return base.filter((it) => it.status === 'unqueried' && (!it.phonetic || !it.meaning))
}

export function lookupChunks(base: VocabItem[]): VocabItem[][] {
  return chunk(pickNeedInfo(base), LOOKUP_CHUNK)
}

/** 缺混淆项 → 生成混淆项（按设置分批，0 = 一次全带）。 */
export function pickConfusable(base: VocabItem[]): VocabItem[] {
  return base.filter((it) => it.meaning && !it.confusables?.length)
}

export function confusableChunks(base: VocabItem[], batchSize: number): VocabItem[][] {
  const todo = pickConfusable(base)
  const size = batchSize > 0 ? batchSize : todo.length || 1
  return chunk(todo, size)
}

/** 例句：还没「AI 例句」就生成；离线例句不算数，AI 仍会给一份带中文的。 */
export function pickExamples(base: VocabItem[]): VocabItem[] {
  return base.filter((it) => it.meaning && needsAiExamples(it)).slice(0, EXAMPLE_MAX)
}

/** 词组 / 习语：有释义、但还没标注过（空数组也算标注过）。 */
export function pickPhrases(base: VocabItem[]): VocabItem[] {
  return base.filter((it) => it.meaning && it.phrases === undefined).slice(0, PHRASE_MAX)
}

/**
 * 本篇语境还没释义的词 → 按本篇上下文重查。查完会把释义写进该语境，
 * 不再是待办（天然的终结标记，不会无限重跑）。
 */
export function pickContextLookup(base: VocabItem[], articleId: string): VocabItem[] {
  return base
    .filter((it) => it.meaning && (it.contexts ?? []).some((c) => c.fileName === articleId && !c.meaning))
    .slice(0, CONTEXT_MAX)
}

/** 疑似非原型 → 校正原形。 */
export function pickLemmas(base: VocabItem[]): VocabItem[] {
  return base.filter((it) => normalizeWord(it.word) !== it.lemma).slice(0, LEMMA_MAX)
}

/** -ing/-ed → 语法辨析（已经辨析过的不再排）。 */
export function pickPos(base: VocabItem[]): VocabItem[] {
  return base
    .filter((it) => (hasIngEd(it.word) || normalizeWord(it.word) !== it.lemma) && !it.note.includes('辨析'))
    .slice(0, POS_MAX)
}

/**
 * 名词/动词/形容词缺语法标记 → 标注。
 * 判「标注过」看字段**是否存在**（空数组也算标注过），否则「查过但无可标」的词会永远重复跑。
 */
export function pickMarks(base: VocabItem[]): VocabItem[] {
  return base.filter((it) => it.meaning && isMarkablePos(it.partOfSpeech) && it.grammarMarks === undefined).slice(0, MARK_MAX)
}

/** 翻译 / 语言点共用的分块（每块最多 6 句）。 */
export function sentenceChunks<T>(items: T[]): T[][] {
  return chunk(items, SENTENCE_CHUNK)
}
