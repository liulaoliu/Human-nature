import type {
  ReviewState,
  VocabConfusable,
  VocabExample,
  VocabItem,
  VocabLibrary,
  VocabSource,
  VocabStatus,
  WordAnalysis,
} from '../types/document'
import { SCHEMA_VERSION, defaultReviewState } from '../types/document'

/**
 * 词库逻辑：生词数据「怎么变」的规则层。
 *
 * 纯函数，不碰界面、不碰 IndexedDB，所以能直接单测。
 *   - 标记：从阅读界面来，按 lemma 去重，回填来源与例句
 *   - 合并：把「一键提示词」粘回的 WordAnalysis 填进词条
 *   - 编辑 / 状态流转 / 删除
 *   - 筛选 / 分组 / 排序（打印与 Anki 导出用）
 *   - 自研复习排期（SM-2 变体；与 Anki 并存）
 *
 * 存储层（IndexedDB）在 adapters/vocabRepo.ts，界面在 ui/VocabPanel.tsx。
 */

/** 不规则形 → 原形。规则表覆盖不到的常见词放这里。 */
const IRREGULAR: Record<string, string> = {
  am: 'be', is: 'be', are: 'be', was: 'be', were: 'be', been: 'be', being: 'be',
  has: 'have', had: 'have', having: 'have',
  does: 'do', did: 'do', done: 'do', doing: 'do',
  goes: 'go', went: 'go', gone: 'go',
  ran: 'run', runs: 'run',
  children: 'child', men: 'man', women: 'woman', people: 'person',
  mice: 'mouse', feet: 'foot', teeth: 'tooth', geese: 'goose',
  better: 'good', best: 'good', worse: 'bad', worst: 'bad',
  made: 'make', took: 'take', gave: 'give', came: 'come', became: 'become',
  saw: 'see', knew: 'know', said: 'say', found: 'find', told: 'tell',
  thought: 'think', got: 'get', wrote: 'write', drove: 'drive',
  using: 'use', uses: 'use', used: 'use',
}

/** 把词形归一化成小写、统一撇号/连字符，去掉标点。 */
export function normalizeWord(raw: string): string {
  return raw
    .normalize('NFKC')
    .replace(/[\u2018\u2019\u02bc\u2032]/g, "'")
    .replace(/[\u2010-\u2015\u2212]/g, '-')
    .replace(/[^A-Za-z'\- ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
}

/**
 * 取 lemma（去重用的归一化形式）。
 *
 * 这是启发式还原，不是完整词形还原：不规则形查表，其余走少量后缀规则
 * （复数、-ing、-ed）。覆盖不到的会偏，但同形/同词的常见变体能合并，
 * 后续可整体换成更完整的词形还原库。
 */
export function lemmaOf(raw: string): string {
  const w = normalizeWord(raw)
  if (!w) return ''
  // 短语（含空格）不做词形还原，原样作为去重键
  if (w.includes(' ')) return w
  if (IRREGULAR[w]) return IRREGULAR[w]
  let s = w.replace(/'s$/, '')
  if (s.length <= 2) return s

  if (/(s|x|z|ch|sh)es$/.test(s)) s = s.slice(0, -2)
  else if (/ies$/.test(s) && s.length > 4) s = s.slice(0, -3) + 'y'
  else if (/[^s]s$/.test(s)) s = s.slice(0, -1)

  if (/ing$/.test(s) && s.length > 4) {
    let base = s.slice(0, -3)
    if (/([bcdgklmnprtvz])\1$/.test(base)) base = base.slice(0, -1)
    else if (/[^aeiou][aeiou][^aeiouwxy]$/.test(base)) base += 'e'
    s = base
  } else if (/ed$/.test(s) && s.length > 3) {
    let base = s.slice(0, -2)
    if (/([bcdgklmnprtvz])\1$/.test(base)) base = base.slice(0, -1)
    else if (/[^aeiou][aeiou][^aeiouwxy]$/.test(base)) base += 'e'
    s = base
  }
  return s
}

/** 空词库。 */
export function createLibrary(): VocabLibrary {
  return { schemaVersion: SCHEMA_VERSION, items: [] }
}

function replaceItem(library: VocabLibrary, item: VocabItem): VocabLibrary {
  return {
    ...library,
    items: library.items.map((it) => (it.id === item.id ? item : it)),
  }
}

function mergeExamples(a: VocabExample[], b: VocabExample[]): VocabExample[] {
  const out = [...a]
  for (const e of b) {
    const key = (x: VocabExample) => x.sentenceId ?? `${x.text}`
    if (!out.some((x) => key(x) === key(e))) out.push(e)
  }
  return out
}

function mergeUnique(a: string[], b: string[]): string[] {
  const out = [...a]
  for (const x of b) if (!out.includes(x)) out.push(x)
  return out
}

function mergeConfusables(
  a: VocabConfusable[] | undefined,
  b: VocabConfusable[] | undefined,
): VocabConfusable[] | undefined {
  const out: VocabConfusable[] = [...(a ?? [])]
  for (const c of b ?? []) {
    if (!out.some((x) => x.word.toLowerCase() === c.word.toLowerCase())) out.push(c)
  }
  return out.length ? out : undefined
}

export interface MarkInput {
  word: string
  articleId: string
  fileName?: string | null
  sentenceId?: string | null
  /** 标词时所在的整句原文，用于回填例句与来源 */
  sentenceText?: string
}

export interface MarkResult {
  library: VocabLibrary
  item: VocabItem
  /** 是新建还是命中了已有词条（去重） */
  created: boolean
}

/**
 * 标记一个词。按 lemma 去重：
 *   - 已有 → 只追加来源/例句、更新时间，不新建
 *   - 没有 → 建新词条，status = unqueried
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
  }
  const source: VocabSource = {
    articleId: input.articleId,
    fileName: input.fileName ?? null,
    sentenceId: input.sentenceId ?? null,
    sentenceText: input.sentenceText ?? '',
  }

  const existing = library.items.find((it) => it.lemma === lemma)
  if (existing) {
    const merged: VocabItem = {
      ...existing,
      examples: mergeExamples(existing.examples, [example]),
      source: existing.source ?? source,
      updatedAt: iso,
    }
    return { library: replaceItem(library, merged), item: merged, created: false }
  }

  const item: VocabItem = {
    id: `vocab:${lemma}`,
    word: input.word.trim(),
    lemma,
    phonetic: null,
    partOfSpeech: null,
    meaning: null,
    usage: [],
    examples: [example],
    source,
    status: 'unqueried',
    note: '',
    tags: [],
    reviewState: defaultReviewState(),
    createdAt: iso,
    updatedAt: iso,
  }
  return { library: { ...library, items: [...library.items, item] }, item, created: true }
}

/**
 * 把「一键提示词」粘回解析出的词条结果合并进词库。
 *   - 已有词条：填缺的音标/词性/含义，用法与例句并入；手动改过/已掌握的不覆盖含义
 *   - 没标记过的词：也建条目（整篇批量查词会用到），source 为 null
 */
export function applyWordAnalysis(
  library: VocabLibrary,
  words: WordAnalysis[],
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

    if (idx === -1) {
      items = [
        ...items,
        {
          id: `vocab:${lemma}`,
          word: wa.word.trim(),
          lemma,
          phonetic: wa.phonetic ?? null,
          partOfSpeech: wa.partOfSpeech ?? null,
          meaning: wa.meaning ?? null,
          usage: wa.usage ?? [],
          examples,
          source: defaultSource ?? null,
          status: 'queried',
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
    const locked = cur.status === 'edited' || cur.status === 'mastered'
    // 查询结果里的「原形」优先：连 word/lemma/id 一起改，保持三者一致（手动改过的不动）
    const newWord = locked ? cur.word : wa.word?.trim() || cur.word
    const newLemma = locked ? cur.lemma : lemmaOf(newWord) || cur.lemma
    const merged: VocabItem = {
      ...cur,
      id: locked ? cur.id : `vocab:${newLemma}`,
      word: newWord,
      lemma: newLemma,
      phonetic: cur.phonetic ?? wa.phonetic ?? null,
      partOfSpeech: cur.partOfSpeech ?? wa.partOfSpeech ?? null,
      meaning: locked && cur.meaning ? cur.meaning : wa.meaning ?? cur.meaning,
      usage: mergeUnique(cur.usage, wa.usage ?? []),
      examples: mergeExamples(cur.examples, examples),
      status: locked ? cur.status : 'queried',
      updatedAt: iso,
    }
    items = items.map((it, i) => (i === idx ? merged : it))
  }

  return { ...library, items }
}

/**
 * 把 AI 生成的混淆项（形近/义近词）写回对应词条。
 * 按 lemma 匹配；已有的会被覆盖（视为刷新）。
 */
export function applyConfusables(
  library: VocabLibrary,
  results: { word: string; confusables: VocabConfusable[] }[],
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
      return c ? { ...it, confusables: c, updatedAt: iso } : it
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

/** 手动编辑一个词条，默认把状态置为 edited（不会被后续查询覆盖）。 */
export function editItem(  library: VocabLibrary,
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
      key = it.createdAt.slice(0, 10)
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

export type ReviewGrade = 'again' | 'hard' | 'good' | 'easy'

/** 背单词的两种模式：新学习 / 复习。 */
export type StudyMode = 'learn' | 'review'

const QUALITY: Record<ReviewGrade, number> = { again: 1, hard: 3, good: 4, easy: 5 }

function addDays(d: Date, days: number): Date {
  const r = new Date(d.getTime())
  r.setDate(r.getDate() + days)
  return r
}

/**
 * SM-2 变体的复习推进。纯函数，返回新的 ReviewState。
 *   - again（q=1）：重来，repetitions 归零，间隔 1 天，ease −0.2（下限 1.3）
 *   - hard/good/easy：repetitions +1，间隔 1 → 6 → round(interval × ease)
 */
export function review(state: ReviewState, grade: ReviewGrade, now: Date = new Date()): ReviewState {
  const q = QUALITY[grade]
  let { ease, interval, repetitions } = state
  let lapses = state.lapses ?? 0
  if (q < 3) {
    repetitions = 0
    interval = 1
    ease = Math.max(1.3, ease - 0.2)
    lapses += 1
  } else {
    repetitions += 1
    if (repetitions === 1) interval = 1
    else if (repetitions === 2) interval = 6
    else interval = Math.round(interval * ease)
    ease = Math.max(1.3, ease + (0.1 - (5 - q) * (0.08 + (5 - q) * 0.02)))
  }
  return { ease, interval, repetitions, due: addDays(now, interval).toISOString(), lapses }
}

/** 推进某个词条的复习状态。 */
export function reviewItem(
  library: VocabLibrary,
  id: string,
  grade: ReviewGrade,
  now: Date = new Date(),
): VocabLibrary {
  return {
    ...library,
    items: library.items.map((it) =>
      it.id === id ? { ...it, reviewState: review(it.reviewState, grade, now), updatedAt: now.toISOString() } : it,
    ),
  }
}

export function isDue(item: VocabItem, now: Date = new Date()): boolean {
  return item.reviewState.due !== null && new Date(item.reviewState.due) <= now
}

/** 到期（含逾期）的词条，按到期时间升序。 */
export function dueItems(items: VocabItem[], now: Date = new Date()): VocabItem[] {
  return sortItems(items.filter((it) => isDue(it, now)), 'due')
}

/** 合并两个同 lemma 的词条（信息互补；不丢字段）。 */
function mergeItem(a: VocabItem, b: VocabItem): VocabItem {
  const rank: Record<VocabStatus, number> = { unqueried: 0, queried: 1, edited: 2, mastered: 3 }
  const stronger = rank[a.status] >= rank[b.status] ? a : b
  return {
    ...a,
    phonetic: a.phonetic ?? b.phonetic,
    partOfSpeech: a.partOfSpeech ?? b.partOfSpeech,
    meaning: a.meaning ?? b.meaning,
    usage: mergeUnique(a.usage, b.usage),
    examples: mergeExamples(a.examples, b.examples),
    tags: [...new Set([...a.tags, ...b.tags])],
    confusables: mergeConfusables(a.confusables, b.confusables),
    note: a.note || b.note,
    source: a.source ?? b.source,
    status: stronger.status,
    reviewState: stronger.reviewState,
    createdAt: a.createdAt < b.createdAt ? a.createdAt : b.createdAt,
    updatedAt: a.updatedAt > b.updatedAt ? a.updatedAt : b.updatedAt,
  }
}

/**
 * 整库按 lemma 去重（合并）。加载/导入后跑一道，
 * 保证即使旧数据或词形还原边角也不会出现两个同根词。
 */
export function dedupeLibrary(library: VocabLibrary): VocabLibrary {
  const byLemma = new Map<string, VocabItem>()
  for (const it of library.items) {
    const prev = byLemma.get(it.lemma)
    byLemma.set(it.lemma, prev ? mergeItem(prev, it) : it)
  }
  return { ...library, items: [...byLemma.values()] }
}

/**
 * 背单词的出场顺序：先到期的，再没学过的，最后其它。
 * opts.newLimit / newToday 用来限制「每天新词量」。
 */
export function buildStudyQueue(
  items: VocabItem[],
  now: Date = new Date(),
  opts: { newLimit?: number; newToday?: number } = {},
): VocabItem[] {
  const isDue = (it: VocabItem) => it.reviewState.due !== null && new Date(it.reviewState.due) <= now
  const byDue = (a: VocabItem, b: VocabItem) =>
    (a.reviewState.due ?? '').localeCompare(b.reviewState.due ?? '') ||
    a.createdAt.localeCompare(b.createdAt)
  const due = items.filter(isDue).sort(byDue)
  const freshAll = items.filter((it) => it.reviewState.repetitions === 0 && !isDue(it))
  const remaining =
    opts.newLimit && opts.newLimit > 0 ? Math.max(0, opts.newLimit - (opts.newToday ?? 0)) : Infinity
  const fresh = freshAll.slice(0, remaining)
  const rest = items.filter((it) => it.reviewState.repetitions > 0 && !isDue(it)).sort(byDue)
  return [...due, ...fresh, ...rest]
}

/**
 * 新学习队列：只取「没学过」（repetitions=0）的，按加入时间。
 * 受每日新词配额限制（newLimit / newToday）。
 */
export function buildLearnQueue(
  items: VocabItem[],
  _now: Date = new Date(),
  opts: { newLimit?: number; newToday?: number } = {},
): VocabItem[] {
  const fresh = items
    .filter((it) => it.reviewState.repetitions === 0)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
  const remaining =
    opts.newLimit && opts.newLimit > 0 ? Math.max(0, opts.newLimit - (opts.newToday ?? 0)) : Infinity
  return fresh.slice(0, remaining)
}

/** 复习队列：只取「已学过且到期」的，按到期时间升序（逾期最久的排前面）。 */
export function buildReviewQueue(items: VocabItem[], now: Date = new Date()): VocabItem[] {
  return items
    .filter(
      (it) =>
        it.reviewState.repetitions > 0 &&
        it.reviewState.due !== null &&
        new Date(it.reviewState.due) <= now,
    )
    .sort(
      (a, b) =>
        (a.reviewState.due ?? '').localeCompare(b.reviewState.due ?? '') ||
        a.createdAt.localeCompare(b.createdAt),
    )
}
