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
import type { PosRow } from './analyzer'

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
  else if (/[^s]s$/.test(s) && !/(us|ss|is|os)$/.test(s)) s = s.slice(0, -1)

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

/** 词性全称 → 缩写（离线词典/AI 有时给 "noun" 全称）。 */
const POS_ABBR: Record<string, string> = {
  noun: 'n.',
  verb: 'v.',
  adjective: 'adj.',
  adverb: 'adv.',
  preposition: 'prep.',
  conjunction: 'conj.',
  pronoun: 'pron.',
  numeral: 'num.',
  article: 'art.',
  interjection: 'interj.',
}

/** 规范化词性显示：「noun」→「n.」。 */
export function normalizePos(pos: string | null | undefined): string {
  const p = (pos ?? '').trim()
  if (!p) return ''
  const key = p.toLowerCase().replace(/\.+$/, '').trim()
  return POS_ABBR[key] ?? p
}

/**
 * 清洗释义/英英：数据里常见行尾转义残留的「\」（ECDICT/AI 都有），
 * 还有多余空白与首尾分隔符。中文英文都过一遍。
 */
export function cleanGloss(s: string | null | undefined): string {
  return (s ?? '')
    .replace(/\\+/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^[\s;,.，、]+/, '')
    .replace(/[\s;,，、]+$/, '')
    .trim()
}

/** 若释义开头与词性重复（词性 n. 且释义以「n. 」或「noun 」开头），去掉重复那段。 */
export function stripLeadingPos(pos: string | null | undefined, gloss: string): string {
  const abbr = normalizePos(pos)
  if (!abbr) return gloss
  const tokens = [abbr, (pos ?? '').trim()].filter(Boolean)
  let out = gloss
  for (const t of tokens) {
    const esc = t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    out = out.replace(new RegExp('^\\s*' + esc + '\\.?\\s*', 'i'), '')
  }
  return out.trim()
}

/** 词条的展示用中释义（清洗 + 去重复词性）。 */
export function displayMeaning(item: { partOfSpeech: string | null; meaning: string | null }): string {
  return stripLeadingPos(item.partOfSpeech, cleanGloss(item.meaning))
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

/** 合并两个「可选列表」：两边都缺 → 保持缺失（undefined）；否则合并去重。 */
function mergeOptionalList(a: string[] | undefined, b: string[] | undefined): string[] | undefined {
  if (a === undefined && b === undefined) return undefined
  return mergeUnique(a ?? [], b ?? [])
}

/** 一个词最多保留几条例句（避免反复查词越堆越多）。 */
export const MAX_EXAMPLES = 6

/** 把 AI 生成的用法示例并入词条（按 lemma / 词形匹配；例句按文本去重）。 */
export function applyExamples(
  library: VocabLibrary,
  rows: { word: string; examples: { text: string; translation?: string }[] }[],
): VocabLibrary {
  const iso = new Date().toISOString()
  let changed = false
  const items = library.items.map((it) => {
    const row = rows.find((r) => lemmaOf(r.word) === it.lemma || normalizeWord(r.word) === normalizeWord(it.word))
    if (!row) return it
    const merged = mergeExamples(
      it.examples,
      row.examples.map((e) => ({ text: e.text, translation: e.translation })),
    )
    // 保留最早的（含来源句），只裁掉后面多出来的
    const capped = merged.length > MAX_EXAMPLES ? merged.slice(0, MAX_EXAMPLES) : merged
    if (capped.length === it.examples.length) return it
    changed = true
    return { ...it, examples: capped, updatedAt: iso }
  })
  return changed ? { ...library, items } : library
}

/**
 * 把 AI 生成的「词组 / 习语」并入词条（按 lemma / 词形匹配）。
 * 词组去重，并滤掉已经在「用法」里的，避免卡片上「用法」和「词组」两块重复。
 *
 * 被 AI 列出的词 = 已标注过：哪怕词组为空（如 mrs），也写空数组，避免永远重复待办。
 */
export function applyPhrases(
  library: VocabLibrary,
  rows: { word: string; phrases: string[]; idioms: string[] }[],
  now: Date = new Date(),
): VocabLibrary {
  if (!rows.length) return library
  const iso = now.toISOString()
  let changed = false
  const items = library.items.map((it) => {
    const row = rows.find((r) => lemmaOf(r.word) === it.lemma || normalizeWord(r.word) === normalizeWord(it.word))
    if (!row) return it
    const usedKeys = new Set(it.usage.map((u) => normalizeWord(u)))
    const phrases = mergeUnique(
      it.phrases ?? [],
      row.phrases.filter((p) => p.trim() && !usedKeys.has(normalizeWord(p))),
    )
    const idioms = mergeUnique(it.idioms ?? [], row.idioms.filter((s) => s.trim()))
    if (it.phrases !== undefined && it.idioms !== undefined && phrases.length === it.phrases.length && idioms.length === it.idioms.length) {
      return it
    }
    changed = true
    return { ...it, phrases, idioms, updatedAt: iso }
  })
  return changed ? { ...library, items } : library
}

/**
 * 把 AI 标注的「语法标记」（可数/不可数、及物/不及物…）并入词条。
 * 按 lemma / 词形匹配，去重合并。
 *
 * 关键：**被 AI 列出的词 = 已标注过**。哪怕该词没有可标项（marks 为空，如 mrs），
 * 也要把 `grammarMarks` 写成空数组，表示「查过、无可标」，否则会永远重复待办。
 */
export function applyGrammarMarks(
  library: VocabLibrary,
  rows: { word: string; marks: string[] }[],
  now: Date = new Date(),
): VocabLibrary {
  if (!rows.length) return library
  const iso = now.toISOString()
  let changed = false
  const items = library.items.map((it) => {
    const row = rows.find((r) => lemmaOf(r.word) === it.lemma || normalizeWord(r.word) === normalizeWord(it.word))
    if (!row) return it
    const marks = mergeUnique(it.grammarMarks ?? [], row.marks.map((m) => m.trim()).filter(Boolean))
    // 已标注过且没有新增 → 不动（避免无意义地刷新 updatedAt）
    if (it.grammarMarks !== undefined && marks.length === it.grammarMarks.length) return it
    changed = true
    return { ...it, grammarMarks: marks, updatedAt: iso }
  })
  return changed ? { ...library, items } : library
}

/** 词性是否含名词 / 动词 / 形容词（只有这几类才需要标语法标记）。 */
export function isMarkablePos(pos: string | null | undefined): boolean {
  const p = normalizePos(pos)
  if (!p) return false
  const tokens = p.split(/[\/,，;；\s]+/).map((s) => s.replace(/\.+$/, '').trim().toLowerCase())
  return tokens.some((t) => ['n', 'noun', 'v', 'verb', 'adj', 'adjective'].includes(t))
}

/** 本词自己的例句（排除「就是来源句」的那条）。 */
export function ownExamples(item: VocabItem): VocabExample[] {  const src = (item.source?.sentenceText ?? '').trim()
  return item.examples.filter((e) => e.text?.trim() && e.text.trim() !== src)
}

/** 是否有「自己的例句」（只有来源句等于没有）。 */
export function hasOwnExamples(item: VocabItem): boolean {
  return ownExamples(item).length > 0
}

/** 卡片上带小标题的一段内容（规范化「用法 / 词组 / 习语 / 例句 / 来源 / 易混」）。 */
export interface VocabCardBlock {
  key: 'usage' | 'phrases' | 'idioms' | 'examples' | 'source' | 'confusables'
  /** 小标题，如「例句」。 */
  label: string
  lines: string[]
}

/**
 * 把词条整理成卡片上按固定顺序排列、带小标题的内容块。
 * 只返回有内容的块；例句只取「自己的例句」（跳过与来源句相同的那条）。
 */
export function vocabCardBlocks(item: VocabItem, opts: { maxExamples?: number } = {}): VocabCardBlock[] {
  const blocks: VocabCardBlock[] = []
  const push = (key: VocabCardBlock['key'], label: string, lines: string[]) => {
    if (lines.length) blocks.push({ key, label, lines })
  }

  push('usage', '用法', item.usage.map((s) => s.trim()).filter(Boolean))

  push('phrases', '词组', (item.phrases ?? []).map((s) => s.trim()).filter(Boolean))
  push('idioms', '习语', (item.idioms ?? []).map((s) => s.trim()).filter(Boolean))

  const examples = ownExamples(item).map((e) => (e.translation ? `${e.text} — ${e.translation}` : e.text))
  push('examples', '例句', opts.maxExamples != null ? examples.slice(0, opts.maxExamples) : examples)

  const sentence = item.source?.sentenceText?.trim()
  push('source', '来源', sentence ? [sentence] : [])

  push(
    'confusables',
    '易混',
    (item.confusables ?? [])
      .filter((c) => c.word.trim())
      .map((c) => (c.meaning ? `${c.word}（${c.meaning}）` : c.word)),
  )

  return blocks
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
          partOfSpeech: normalizePos(wa.partOfSpeech) || null,
          meaning: cleanGloss(wa.meaning) || null,
          definition: cleanGloss(wa.definition) || null,
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
      partOfSpeech: cur.partOfSpeech ?? (normalizePos(wa.partOfSpeech) || null),
      meaning: locked && cur.meaning ? cur.meaning : cleanGloss(wa.meaning) || cur.meaning,
      definition: locked && cur.definition ? cur.definition : cleanGloss(wa.definition) || cur.definition,
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
    const rewrite = single && !locked && !!row.lemma.trim()
    const nextWord = rewrite ? row.lemma.trim() : cur.word
    const nextLemma = rewrite ? lemmaOf(nextWord) || cur.lemma : cur.lemma
    const noteLine = `[辨析] ${row.surface} — ${row.syntax || ''}${row.role ? `；${row.role}` : ''}${
      row.reason ? `；${row.reason}` : ''
    }${row.label || row.pos ? ` → ${row.label || row.pos}` : ''}`
    items[idx] = {
      ...cur,
      id: rewrite ? `vocab:${nextLemma}` : cur.id,
      word: nextWord,
      lemma: nextLemma,
      partOfSpeech: row.pos || cur.partOfSpeech,
      meaning: cur.meaning ?? row.meaning ?? null,
      note: cur.note ? `${cur.note}\n${noteLine}` : noteLine,
      updatedAt: iso,
    }
  }
  return { ...library, items }
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

/** 次日 ISO（优先重排用）。 */
export function nextDayIso(now: Date = new Date()): string {
  return addDays(now, 1).toISOString()
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

/** 是否打印过（老数据没有 lastPrintedAt，按未打印算）。 */export function isPrinted(item: VocabItem): boolean {
  return !!item.lastPrintedAt
}

/** 未打印过的词条（用于「只打未打印」）。 */
export function unprintedItems(items: VocabItem[]): VocabItem[] {
  return items.filter((it) => !it.lastPrintedAt)
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
    definition: a.definition ?? b.definition,
    usage: mergeUnique(a.usage, b.usage),
    phrases: mergeOptionalList(a.phrases, b.phrases),
    idioms: mergeOptionalList(a.idioms, b.idioms),
    grammarMarks: mergeOptionalList(a.grammarMarks, b.grammarMarks),
    examples: mergeExamples(a.examples, b.examples),
    tags: [...new Set([...a.tags, ...b.tags])],
    confusables: mergeConfusables(a.confusables, b.confusables),
    priorityUntil: [a.priorityUntil, b.priorityUntil].filter(Boolean).sort().pop() ?? null,
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
 * 「优先重排」（答错过的词，priorityUntil 未过期）排在到期组最前。
 */
export function buildStudyQueue(
  items: VocabItem[],
  now: Date = new Date(),
  opts: { newLimit?: number; newToday?: number } = {},
): VocabItem[] {
  const isDue = (it: VocabItem) => it.reviewState.due !== null && new Date(it.reviewState.due) <= now
  const prio = (it: VocabItem) => (isPriority(it, now) ? 0 : 1)
  const byDue = (a: VocabItem, b: VocabItem) =>
    prio(a) - prio(b) ||
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

/** 复习队列：只取「已学过且到期」的，优先重排的最前，其次按到期时间升序（逾期最久在前）。 */
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
        (isPriority(a, now) ? 0 : 1) - (isPriority(b, now) ? 0 : 1) ||
        (a.reviewState.due ?? '').localeCompare(b.reviewState.due ?? '') ||
        a.createdAt.localeCompare(b.createdAt),
    )
}
