import type {
  VocabConfusable,
  VocabConfusableSource,
  VocabExample,
  VocabField,
  VocabFieldSource,
  VocabFieldSources,
  VocabItem,
  VocabKind,
  VocabLibrary,
  VocabOrigin,
  VocabSource,
  VocabVia,
  WordAnalysis,
} from '../../types/document'
import { defaultReviewState } from '../../types/document'
import type { PosRow } from '../analyzer'
import { addArticleEntry } from '../articleVocab'
import { VOCAB_FIELDS, isFieldLocked } from '../vocabFields'
import { reconcileSense } from './sense'
import { canRewriteTo, lemmaOf, normalizePos, normalizeWord, cleanGloss } from './word'
import {
  betterSource,
  contextFromSource,
  mergeExamples,
  mergeUnique,
  upsertContext,
} from './merge'

/** 查词结果 + 每个字段的来源（AI / 离线词典）；直接调用不传时按 AI 处理。 */
export type WordAnalysisWithSources = WordAnalysis & { fieldSources?: VocabFieldSources }

const hasText = (v: string | null | undefined): v is string => !!v?.trim()

function sourceOf(wa: WordAnalysisWithSources, field: VocabField): VocabFieldSource {
  return wa.fieldSources?.[field] ?? 'ai'
}

/**
 * 分析结果回填：标记单词、粘回 AI 查词结果、混淆项、原形校正、-ing/-ed 辨析。
 *
 * 输入都是外部数据（阅读界面 / AI 粘回），这里负责把它们并进词库；
 * 解析与守卫在调用方完成，本层只处理「已经合法的结构」。
 */

function replaceItem(library: VocabLibrary, item: VocabItem): VocabLibrary {
  return {
    ...library,
    items: library.items.map((it) => (it.id === item.id ? item : it)),
  }
}

export interface MarkInput {
  word: string
  articleId: string
  fileName?: string | null
  sentenceId?: string | null
  /** 标词时所在的整句原文，用于回填例句与来源 */
  sentenceText?: string
  /** 已知的释义（如「词组 — 中文」里的中文），标词时直接写上 */
  meaning?: string
  /** 词条类型（词组 / 习语 / 用法笔记；不传 = 普通单词） */
  kind?: VocabKind
  /** 收录方式：自动标词 / 手动加入（默认手动；只影响按篇条目的标签） */
  origin?: VocabOrigin
  /** 细分来源：AI / 离线词典 / 手动 / 语言点 */
  via?: VocabVia
}

export interface MarkResult {
  library: VocabLibrary
  item: VocabItem
  /** 是新建还是命中了已有词条（去重） */
  created: boolean
}

/** 把已入库的单词收进当前篇；词组/习语/用法和多词条目不进正文编号。 */
function collectToArticle(
  library: VocabLibrary,
  input: MarkInput,
  item: VocabItem,
  iso: string,
): VocabLibrary {
  if (input.kind && input.kind !== 'word') return library
  if (/\s/.test(input.word.trim())) return library
  const articleId = input.fileName?.trim() || input.articleId?.trim() || ''
  if (!articleId) return library
  return addArticleEntry(
    library,
    {
      articleId,
      lemma: item.lemma,
      origin: input.origin ?? 'manual',
      via: input.via,
      sentenceId: input.sentenceId ?? null,
      sentenceText: input.sentenceText ?? '',
      meaning: input.meaning?.trim() || null,
      meaningSource: input.meaning?.trim() ? 'manual' : undefined,
    },
    new Date(iso),
  )
}

/**
 * 标记一个词。按 lemma 去重：
 *   - 已有 → 只追加来源/例句、更新时间，不新建
 *   - 没有 → 建新词条，status = unqueried
 *
 * 同时把它收进**当前篇**的按篇条目（只收普通单词；词组/习语/用法不参与正文编号）。
 */
export function markWord(
  library: VocabLibrary,
  input: MarkInput,
  now: Date = new Date(),
): MarkResult {
  const lemma = lemmaOf(input.word)
  if (!lemma) throw new Error('markWord: 空的单词')
  const iso = now.toISOString()
  const example: VocabExample = {
    text: input.sentenceText ?? input.word,
    articleId: input.articleId,
    fileName: input.fileName ?? undefined,
    sentenceId: input.sentenceId ?? undefined,
    origin: 'article',
  }
  const source: VocabSource = {
    articleId: input.articleId,
    fileName: input.fileName ?? null,
    sentenceId: input.sentenceId ?? null,
    sentenceText: input.sentenceText ?? '',
  }

  const existing = library.items.find((it) => it.lemma === lemma)
  const given = input.meaning?.trim() || null
  // 「单词」不写 kind（老数据也没有），保持数据干净；词组/习语/用法才标
  const kind = input.kind && input.kind !== 'word' ? input.kind : undefined
  if (existing) {
    // 已有释义不改；只在「这次才补上释义」时记手动来源
    const meaning = existing.meaning ?? given
    const fieldSources =
      !existing.meaning && given
        ? { ...existing.fieldSources, meaning: 'manual' as const }
        : existing.fieldSources
    const merged: VocabItem = {
      ...existing,
      kind: existing.kind ?? kind,
      examples: mergeExamples(existing.examples, [example]),
      source: betterSource(existing.source, source),
      contexts: upsertContext(existing.contexts, contextFromSource(source, iso, given ?? undefined)),
      meaning,
      fieldSources,
      updatedAt: iso,
    }
    return {
      library: collectToArticle(replaceItem(library, merged), input, merged, iso),
      item: merged,
      created: false,
    }
  }

  const item: VocabItem = {
    id: `vocab:${lemma}`,
    word: input.word.trim(),
    lemma,
    kind,
    phonetic: null,
    partOfSpeech: null,
    meaning: given,
    fieldSources: given ? { meaning: 'manual' } : undefined,
    usage: [],
    examples: [example],
    source,
    // 词组/习语/用法笔记是语言点里直接带释义收过来的，没有「待查」这一步
    status: given || kind ? 'queried' : 'unqueried',
    note: '',
    tags: [],
    contexts: [contextFromSource(source, iso, given ?? undefined)],
    reviewState: defaultReviewState(),
    createdAt: iso,
    updatedAt: iso,
  }
  return {
    library: collectToArticle({ ...library, items: [...library.items, item] }, input, item, iso),
    item,
    created: true,
  }
}

/**
 * 把「一键提示词」粘回解析出的词条结果合并进词库。
 *   - 已有词条：填缺的音标/词性/含义，用法与例句并入；手动改过/已掌握的不覆盖含义
 *   - 没标记过的词：也建条目（整篇批量查词会用到），source 为 null
 */
export function applyWordAnalysis(
  library: VocabLibrary,
  words: WordAnalysisWithSources[],
  now: Date = new Date(),
  defaultSource?: VocabSource,
): VocabLibrary {
  const iso = now.toISOString()
  let items = library.items

  for (const wa of words) {
    const lemma = lemmaOf(wa.word)
    if (!lemma) continue
    const target = normalizeWord(wa.word)
    // 命中已有：按 lemma，或按词形完全一致（容忍历史遗留的怪 lemma）
    const idx = items.findIndex((it) => it.lemma === lemma || (target && normalizeWord(it.word) === target))
    const examples = (wa.examples ?? []).map((e) => ({
      text: e.text,
      translation: e.translation,
    }))
    const incoming: Record<VocabField, string | null> = {
      phonetic: hasText(wa.phonetic) ? wa.phonetic : null,
      partOfSpeech: normalizePos(wa.partOfSpeech || '') || null,
      meaning: cleanGloss(wa.meaning) || null,
      definition: cleanGloss(wa.definition) || null,
    }
    const incomingSources: VocabFieldSources = {}
    for (const field of VOCAB_FIELDS) {
      if (hasText(incoming[field])) incomingSources[field] = sourceOf(wa, field)
    }

    if (idx === -1) {
      items = [
        ...items,
        {
          id: `vocab:${lemma}`,
          word: wa.word.trim(),
          lemma,
          phonetic: incoming.phonetic,
          partOfSpeech: incoming.partOfSpeech,
          meaning: incoming.meaning,
          definition: incoming.definition,
          fieldSources: Object.keys(incomingSources).length ? incomingSources : undefined,
          usage: wa.usage ?? [],
          examples,
          source: defaultSource ?? null,
          status: 'queried',
          contexts: defaultSource ? [contextFromSource(defaultSource, iso, incoming.meaning ?? undefined)] : undefined,
          note: '',
          tags: [],
          reviewState: defaultReviewState(),
          createdAt: iso,
          updatedAt: iso,
        },
      ]
      continue
    }

    const cur = items[idx]
    // 词形 / id 仍按旧规则整条锁：手动改过或已掌握的不让查询结果改身份
    const identityLocked = cur.status === 'edited' || cur.status === 'mastered'
    const newWord = identityLocked ? cur.word : wa.word?.trim() || cur.word
    const newLemma = identityLocked ? cur.lemma : lemmaOf(newWord) || cur.lemma
    const fieldSources: VocabFieldSources = { ...cur.fieldSources }

    // 音标只补空；词性与释义要**同源**（释义换了说法，词性就必须跟着换，见下）
    let phonetic = cur.phonetic
    if (!isFieldLocked(cur, 'phonetic') && !cur.phonetic && incoming.phonetic) {
      phonetic = incoming.phonetic
      fieldSources.phonetic = sourceOf(wa, 'phonetic')
    }
    let meaning = cur.meaning
    let meaningReplaced = false
    if (!isFieldLocked(cur, 'meaning') && incoming.meaning) {
      meaningReplaced = incoming.meaning !== cur.meaning
      meaning = incoming.meaning
      fieldSources.meaning = sourceOf(wa, 'meaning')
    }
    let partOfSpeech = cur.partOfSpeech
    if (!isFieldLocked(cur, 'partOfSpeech')) {
      // 词典补的词性是**词头首义**，AI 给的是**语境义项**，两者不是一回事
      // （consort → n. 交往；厮混）。词典那条只能算占位，不能挡住 AI：
      // rival 重查时返回的释义和上一版一字不差，旧逻辑「释义没变就不动词性」，
      // 于是 dict 的 n. 一直压着语境里的 v.。
      const dictPlaceholder = fieldSources.partOfSpeech === 'dict'
      if (incoming.partOfSpeech && (meaningReplaced || dictPlaceholder || !cur.partOfSpeech)) {
        // 释义和词性来自同一行答案，必须一起采纳
        partOfSpeech = incoming.partOfSpeech
        fieldSources.partOfSpeech = sourceOf(wa, 'partOfSpeech')
      } else if (meaningReplaced) {
        // 换了说法却没给词性：宁可空着，也不能留着上一版的词性凑一对
        partOfSpeech = null
        delete fieldSources.partOfSpeech
      }
    }
    let definition = cur.definition
    if (!isFieldLocked(cur, 'definition') && incoming.definition) {
      definition = incoming.definition
      fieldSources.definition = sourceOf(wa, 'definition')
    }

    const ctxMeaning = incoming.meaning ?? undefined
    const merged: VocabItem = reconcileSense({
      ...cur,
      id: identityLocked ? cur.id : `vocab:${newLemma}`,
      word: newWord,
      lemma: newLemma,
      phonetic,
      partOfSpeech,
      meaning,
      definition,
      fieldSources: Object.keys(fieldSources).length ? fieldSources : undefined,
      usage: mergeUnique(cur.usage, wa.usage ?? []),
      examples: mergeExamples(cur.examples, examples),
      source: betterSource(cur.source, defaultSource ?? { articleId: '', fileName: null, sentenceId: null, sentenceText: '' }),
      contexts: defaultSource ? upsertContext(cur.contexts, contextFromSource(defaultSource, iso, ctxMeaning)) : cur.contexts,
      status: identityLocked ? cur.status : 'queried',
      updatedAt: iso,
    })
    items = items.map((it, i) => (i === idx ? merged : it))
  }

  return { ...library, items }
}

/**
 * 把混淆项（形近/义近词）写回对应词条。
 * 按 lemma 匹配；已有的会被覆盖（视为刷新）。
 *
 * `source` 必须由调用方在写入边界给出（AI / 离线词典），
 * 旧数据没有来源时保持 undefined，不能靠时间或内容反推。
 */
export function applyConfusables(
  library: VocabLibrary,
  results: { word: string; confusables: VocabConfusable[] }[],
  source: VocabConfusableSource,
  now: Date = new Date(),
): VocabLibrary {
  if (!results.length) return library
  const iso = now.toISOString()
  const byLemma = new Map<string, VocabConfusable[]>()
  for (const r of results) {
    const lemma = lemmaOf(r.word)
    if (lemma && r.confusables.length) byLemma.set(lemma, r.confusables)
  }
  return {
    ...library,
    items: library.items.map((it) => {
      const c = byLemma.get(it.lemma)
      return c ? { ...it, confusables: c, confusablesSource: source, updatedAt: iso } : it
    }),
  }
}

/**
 * 按「原词形 → 原形」映射校正词条：改 word / lemma / id。
 * 校正后应再跑一次 dedupeLibrary（可能产生重复）。
 */
export function applyLemmaMap(
  library: VocabLibrary,
  pairs: { from: string; to: string }[],
  now: Date = new Date(),
): VocabLibrary {
  if (!pairs.length) return library
  const iso = now.toISOString()
  const map = new Map<string, string>()
  for (const p of pairs) {
    const f = normalizeWord(p.from)
    const to = p.to.trim()
    if (f && to) map.set(f, to)
  }
  return {
    ...library,
    items: library.items.map((it) => {
      const to = map.get(normalizeWord(it.word)) ?? map.get(it.lemma)
      if (!to) return it
      const lemma = lemmaOf(to)
      return { ...it, word: to, lemma, id: `vocab:${lemma}`, updatedAt: iso }
    }),
  }
}

/**
 * 重新按 word 计算 lemma（修正历史遗留的旧 lemma / 不统一）。
 * 之后配合 dedupeLibrary 合并重复。
 */
export function relemmaLibrary(library: VocabLibrary): VocabLibrary {
  return {
    ...library,
    items: library.items.map((it) => {
      const lemma = lemmaOf(it.word)
      return lemma && lemma !== it.lemma ? { ...it, lemma, id: `vocab:${lemma}` } : it
    }),
  }
}

/**
 * 写回 -ing/-ed 语法辨析结果：
 *   - 单词条目（非短语）按其原形改 word/lemma/id；短语条目保持词形不变
 *   - 词性用短标注；完整辨析（语法身份/成分/理由/最准确词性）追加进 note
 * 之后建议跑一次 dedupeLibrary。
 */
export function applyPosAnalysis(
  library: VocabLibrary,
  rows: PosRow[],
  now: Date = new Date(),
): VocabLibrary {
  if (!rows.length) return library
  const iso = now.toISOString()
  const items = [...library.items]
  for (const row of rows) {
    const surface = normalizeWord(row.surface)
    const lemma = normalizeWord(row.lemma)
    if (!surface) continue
    // 匹配条目：词形等于当前形式 → 短语里含当前形式 → lemma 相同
    let idx = items.findIndex((it) => normalizeWord(it.word) === surface)
    if (idx < 0) idx = items.findIndex((it) => normalizeWord(it.word).split(' ').includes(surface))
    if (idx < 0) idx = items.findIndex((it) => it.lemma === lemma || normalizeWord(it.word) === lemma)
    if (idx < 0) continue
    const cur = items[idx]
    const single = !cur.word.trim().includes(' ')
    const locked = cur.status === 'edited' || cur.status === 'mastered'
    const asked = single && !locked && !!row.lemma.trim() && normalizeWord(row.lemma) !== normalizeWord(cur.word)
    // AI 给的原形只在**确认是屈折**时才用来改词形（见 `canRewriteTo`）：
    // 否则 unchallenged 会被改成 challenge，而释义/用法/例句原地不动 → 张冠李戴。
    const rewrite = single && !locked && !!row.lemma.trim() && canRewriteTo(cur.word, row.lemma)
    const nextWord = rewrite ? row.lemma.trim() : cur.word
    const nextLemma = rewrite ? lemmaOf(nextWord) || cur.lemma : cur.lemma
    const fieldSources: VocabFieldSources = { ...cur.fieldSources }
    const pos = row.pos.trim()
    const partOfSpeech = !isFieldLocked(cur, 'partOfSpeech') && pos ? pos : cur.partOfSpeech
    if (partOfSpeech !== cur.partOfSpeech) fieldSources.partOfSpeech = 'ai'
    const givenMeaning = row.meaning.trim() || null
    const meaning =
      cur.meaning ?? (!isFieldLocked(cur, 'meaning') ? givenMeaning : null)
    if (meaning !== cur.meaning) fieldSources.meaning = 'ai'
    const noteLine = `[辨析] ${row.surface} — ${row.syntax || ''}${row.role ? `；${row.role}` : ''}${
      row.reason ? `；${row.reason}` : ''
    }${row.label || row.pos ? ` → ${row.label || row.pos}` : ''}${
      asked && !rewrite ? `（未改词形：${row.lemma} 是派生词，不是它的词形变化）` : ''
    }`
    items[idx] = {
      ...cur,
      id: rewrite ? `vocab:${nextLemma}` : cur.id,
      word: nextWord,
      lemma: nextLemma,
      partOfSpeech,
      meaning,
      fieldSources: Object.keys(fieldSources).length ? fieldSources : undefined,
      note: cur.note ? `${cur.note}\n${noteLine}` : noteLine,
      updatedAt: iso,
    }
  }
  return { ...library, items }
}
