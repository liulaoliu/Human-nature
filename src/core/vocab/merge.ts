import type {
  VocabConfusable,
  VocabConfusableSource,
  VocabContext,
  VocabExample,
  VocabExampleOrigin,
  VocabField,
  VocabFieldSources,
  VocabItem,
  VocabLibrary,
  VocabSource,
  VocabStatus,
} from '../../types/document'
import { confusableSourceLabel } from '../vocabConfusables'
import { lemmaOf, normalizePos, normalizeWord } from './word'

/**
 * 合并层：把例句 / 词组 / 语法标记 / 分析结果并进词库。
 *
 * 全部是「库进 → 库出」的纯函数，找不到目标词条时原样返回；
 * 合并键统一走 lemma（`word.ts`），不允许各函数自己再拼一套。
 */

/** 来源句是否「有用」（有原句，或有句子 id）。 */
function sourceHasText(s: VocabSource | null | undefined): boolean {
  return !!s && (!!s.sentenceText?.trim() || !!s.sentenceId)
}

/** 有原句的来源优先；都没有就用新的（保证来源不空）。 */
export function betterSource(a: VocabSource | null | undefined, b: VocabSource): VocabSource {
  return sourceHasText(a) ? (a as VocabSource) : b
}

/** 记一条「出现语境」：同篇同句只留一条；同篇新句追加（保留最近 20 条）。 */
export function upsertContext(list: VocabContext[] | undefined, ctx: VocabContext, cap = 20): VocabContext[] {
  const cur = list ?? []
  if (!ctx.fileName && !ctx.sentenceText) return cur
  const key = (c: VocabContext) => `${c.fileName ?? c.articleId}|${c.sentenceId ?? c.sentenceText}`
  const k = key(ctx)
  const i = cur.findIndex((c) => key(c) === k)
  if (i >= 0) {
    const prev = cur[i]
    const next: VocabContext = {
      ...prev,
      ...ctx,
      meaning: ctx.meaning ?? prev.meaning,
      at: prev.at || ctx.at,
    }
    if (next.meaning === prev.meaning && next.sentenceText === prev.sentenceText) return cur
    return cur.map((c, j) => (j === i ? next : c))
  }
  return [...cur, ctx].slice(-cap)
}

/** 由「来源」造一条语境。 */
export function contextFromSource(source: VocabSource, at: string, meaning?: string): VocabContext {
  return {
    articleId: source.articleId,
    fileName: source.fileName,
    sentenceId: source.sentenceId,
    sentenceText: source.sentenceText,
    meaning,
    at,
  }
}

export function mergeExamples(a: VocabExample[], b: VocabExample[]): VocabExample[] {
  const out = [...a]
  for (const e of b) {
    const key = (x: VocabExample) => x.sentenceId ?? `${x.text}`
    if (!out.some((x) => key(x) === key(e))) out.push(e)
  }
  return out
}

export function mergeUnique(a: string[], b: string[]): string[] {
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

/**
 * 把一批例句并入词条（按 lemma / 词形匹配）。
 *
 * - `origin`：这批例句的来源（AI 生成 / 离线例句库）。
 * - 同一正文的已有例句**不重复加**，但 AI 例句会把它的来源「认领」成 `ai`
 *   （这样「还缺 AI 例句」的判据不会因为离线例句先到而永远为真 → 防死循环），并顺手补上缺的翻译。
 */
export function applyExamples(
  library: VocabLibrary,
  rows: { word: string; examples: { text: string; translation?: string }[] }[],
  now: Date = new Date(),
  origin: VocabExampleOrigin = 'ai',
): VocabLibrary {
  const iso = now.toISOString()
  let changed = false
  const items = library.items.map((it) => {
    const row = rows.find((r) => lemmaOf(r.word) === it.lemma || normalizeWord(r.word) === normalizeWord(it.word))
    if (!row) return it
    const next = [...it.examples]
    let touched = false
    for (const inc of row.examples) {
      const text = inc.text.trim()
      if (!text) continue
      const i = next.findIndex((x) => x.text.trim() === text)
      if (i >= 0) {
        const cur = next[i]
        const claim = origin === 'ai' && cur.origin !== 'ai'
        const fillTr = !cur.translation && !!inc.translation
        if (claim || fillTr) {
          next[i] = { ...cur, origin: claim ? 'ai' : cur.origin, translation: fillTr ? inc.translation : cur.translation }
          touched = true
        }
      } else {
        next.push({ text, translation: inc.translation, origin })
        touched = true
      }
    }
    if (!touched) return it
    const capped = next.length > MAX_EXAMPLES ? next.slice(0, MAX_EXAMPLES) : next
    // 裁剪后内容没变（例如已经满了）→ 不算改动，避免反复写库
    const same =
      capped.length === it.examples.length &&
      capped.every(
        (x, i) =>
          x.text === it.examples[i].text &&
          x.origin === it.examples[i].origin &&
          x.translation === it.examples[i].translation,
      )
    if (same) return it
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

/** 语法标记归属的类别：可数性只对名词、及物性只对动词、可分级只对形容词。 */
const MARK_GROUP: Record<string, 'noun' | 'verb' | 'adj'> = {
  可数: 'noun',
  不可数: 'noun',
  及物: 'verb',
  不及物: 'verb',
  可分级: 'adj',
  不可分级: 'adj',
}

/** 词性是否含某一类（n./v./adj）。 */
function posHas(pos: string | null | undefined, kind: 'noun' | 'verb' | 'adj'): boolean {
  const tokens = normalizePos(pos)
    .split(/[\/,，;；\s]+/)
    .map((s) => s.replace(/\.+$/, '').trim().toLowerCase())
  const words = kind === 'noun' ? ['n', 'noun'] : kind === 'verb' ? ['v', 'verb'] : ['adj', 'adjective']
  return tokens.some((t) => words.includes(t))
}

/**
 * 按词性过滤语法标记：**可数/不可数只对名词、及物/不及物只对动词、可分级只对形容词**。
 * 治的是 AI 给形容词（sprawling）也标「不可数」这种张冠李戴。
 * 不在受控词表里的标记（未来的扩展）一律保留。
 */
export function marksForPos(marks: string[], pos: string | null | undefined): string[] {
  const known = !!normalizePos(pos).trim()
  return marks
    .map((m) => m.trim())
    .filter((m) => {
      if (!m) return false
      const g = MARK_GROUP[m]
      if (!g) return true // 不在受控词表里的扩展标记：保留
      if (!known) return true // 词性还没标注：没法判断，先保留
      return posHas(pos, g)
    })
}

/** 整库修一遍语法标记（清掉与词性不匹配的）；加载时跑一次即可，幂等。 */
export function normalizeGrammarMarks(library: VocabLibrary): VocabLibrary {
  let changed = false
  const items = library.items.map((it) => {
    if (!it.grammarMarks?.length) return it
    const fixed = marksForPos(it.grammarMarks, it.partOfSpeech)
    if (fixed.length === it.grammarMarks.length) return it
    changed = true
    return { ...it, grammarMarks: fixed }
  })
  return changed ? { ...library, items } : library
}

/**
 * 把 AI 标注的「语法标记」（可数/不可数、及物/不及物…）并入词条。
 * 按 lemma / 词形匹配，去重合并，并**按词性过滤**（不匹配的丢掉）。
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
    const marks = mergeUnique(it.grammarMarks ?? [], marksForPos(row.marks, it.partOfSpeech))
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
export function ownExamples(item: VocabItem): VocabExample[] {
  const src = (item.source?.sentenceText ?? '').trim()
  return item.examples.filter((e) => e.text?.trim() && e.text.trim() !== src)
}

/** 是否有「自己的例句」（只有来源句等于没有）。 */
export function hasOwnExamples(item: VocabItem): boolean {
  return ownExamples(item).length > 0
}

/** 每个词目标补几条离线例句（离线、免费，和 AI 例句并存）。 */
export const TARGET_OFFLINE_EXAMPLES = 3

/**
 * 从候选里挑出「该补的离线例句」：
 *   - 目标：每词 `target` 条离线例句（按 `origin === 'tatoeba'` 计）——所以是幂等的；
 *   - 不超卡片上限 `MAX_EXAMPLES`，也不重复已有的句子。
 */
export function pickOfflineExamples(
  item: VocabItem,
  candidates: { text: string; translation?: string }[],
  target = TARGET_OFFLINE_EXAMPLES,
): { text: string; translation?: string }[] {
  const have = new Set(item.examples.map((e) => e.text.trim()))
  const offline = item.examples.filter((e) => e.origin === 'tatoeba').length
  const room = MAX_EXAMPLES - item.examples.length
  const want = Math.min(Math.max(0, target - offline), Math.max(0, room))
  if (want <= 0) return []
  return candidates.filter((c) => c.text.trim() && !have.has(c.text.trim())).slice(0, want)
}

/**
 * 「还需要 AI 例句吗」：自己的例句里还没有 AI 生成的（离线例句不算数）。
 * 离线例句先补上时，AI 仍会给一份带中文的；AI 回来后就不再排（防死循环）。
 */
export function needsAiExamples(item: VocabItem): boolean {
  const src = (item.source?.sentenceText ?? '').trim()
  return item.examples.every((e) => e.origin === 'tatoeba' || e.text.trim() === src)
}

/** 卡片上带小标题的一段内容（规范化「语境 / 用法 / 词组 / 习语 / 例句 / 来源 / 易混」）。 */
export interface VocabCardBlock {
  key: 'context' | 'usage' | 'phrases' | 'idioms' | 'examples' | 'source' | 'confusables'
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

  // 语境：在哪些句子里出现过（最近 2 条）；有「此处含义」就带上
  const ctxs = [...(item.contexts ?? [])].reverse().slice(0, 2)
  push(
    'context',
    '语境',
    ctxs
      .filter((c) => c.sentenceText.trim())
      .map((c) => `${c.sentenceText.trim()}${c.meaning ? ` — 此处：${c.meaning}` : ''}`),
  )

  push('phrases', '词组', (item.phrases ?? []).map((s) => s.trim()).filter(Boolean))
  push('idioms', '习语', (item.idioms ?? []).map((s) => s.trim()).filter(Boolean))

  const examples = ownExamples(item).map((e) => {
    const tag = e.origin === 'tatoeba' ? '[离线] ' : e.origin === 'ai' ? '[AI] ' : ''
    return `${tag}${e.translation ? `${e.text} — ${e.translation}` : e.text}`
  })
  push('examples', '例句', opts.maxExamples != null ? examples.slice(0, opts.maxExamples) : examples)

  const sentence = item.source?.sentenceText?.trim()
  push('source', '来源', sentence ? [sentence] : [])

  const confusableTag = confusableSourceLabel(item.confusablesSource)
  const confusablePrefix = confusableTag ? `[${confusableTag}] ` : ''
  push(
    'confusables',
    '易混',
    (item.confusables ?? [])
      .filter((c) => c.word.trim())
      .map((c) => `${confusablePrefix}${c.meaning ? `${c.word}（${c.meaning}）` : c.word}`),
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

/**
 * 合并后的易混项来源：
 *   - 只有一边有易混项 → 用那边的来源；
 *   - 两边都有且来源相同 → 保留；
 *   - 两边来源不同 / 有一边没记录 → undefined（不拿一边的来源代表混合内容）。
 */
function mergeConfusableSource(
  a: VocabItem,
  b: VocabItem,
  merged: VocabConfusable[] | undefined,
): VocabConfusableSource | undefined {
  if (!merged?.length) return undefined
  const aHas = !!a.confusables?.length
  const bHas = !!b.confusables?.length
  if (aHas && !bHas) return a.confusablesSource
  if (bHas && !aHas) return b.confusablesSource
  return a.confusablesSource && a.confusablesSource === b.confusablesSource ? a.confusablesSource : undefined
}

/** 合并两个同 lemma 的词条（信息互补；不丢字段）。 */
function mergeItem(a: VocabItem, b: VocabItem): VocabItem {
  const rank: Record<VocabStatus, number> = { unqueried: 0, queried: 1, edited: 2, mastered: 3 }
  const stronger = rank[a.status] >= rank[b.status] ? a : b
  const confusables = mergeConfusables(a.confusables, b.confusables)
  const fieldSources: VocabFieldSources = {}
  // 字段值取谁，来源就跟着谁；两边都没值时不保留来源
  const pick = (key: VocabField): string | null | undefined => {
    const av = a[key]
    const bv = b[key]
    const aHas = !!av?.trim()
    const bHas = !!bv?.trim()
    if (aHas) {
      if (a.fieldSources?.[key]) fieldSources[key] = a.fieldSources[key]!
      return av
    }
    if (bHas) {
      if (b.fieldSources?.[key]) fieldSources[key] = b.fieldSources[key]!
      return bv
    }
    return av ?? bv
  }
  return {
    ...a,
    phonetic: pick('phonetic') ?? null,
    partOfSpeech: pick('partOfSpeech') ?? null,
    meaning: pick('meaning') ?? null,
    definition: pick('definition'),
    fieldSources: Object.keys(fieldSources).length ? fieldSources : undefined,
    usage: mergeUnique(a.usage, b.usage),
    phrases: mergeOptionalList(a.phrases, b.phrases),
    idioms: mergeOptionalList(a.idioms, b.idioms),
    grammarMarks: mergeOptionalList(a.grammarMarks, b.grammarMarks),
    examples: mergeExamples(a.examples, b.examples),
    tags: [...new Set([...a.tags, ...b.tags])],
    confusables,
    confusablesSource: mergeConfusableSource(a, b, confusables),
    contexts: (a.contexts ?? []).concat(b.contexts ?? []).reduce<VocabContext[]>((acc, c) => upsertContext(acc, c), []),
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
