// ============================================================
// aiApply — AI 结果「表格型任务」的落地规则（纯函数）
//
// 六个任务是同一套骨架：解析文本 → 校验 → 写库 → 生成回执（成功几个 / AI 漏了哪些）。
// 规则放这里（带测试），`reader/hooks/useApplyTaskResult` 只负责挑任务、落库、改界面。
//
// 不在本模块的：自动标词（要用 adapters 的离线词典做级别过滤）、
// 查词表格 / 逐句翻译（要按词回写来源），那些 IO 与上下文太多，仍留在 hook。
// ============================================================
import {
  parseConfusables,
  parseExampleTable,
  parseGrammarMarkTable,
  parseLemmaTable,
  parsePhraseTable,
  parsePosTable,
} from './analyzer'
import {
  applyConfusables,
  applyExamples,
  applyGrammarMarks,
  applyLemmaMap,
  applyPhrases,
  applyPosAnalysis,
  dedupeLibrary,
  lemmaOf,
  normalizeWord,
} from './vocab'
import type { VocabLibrary } from '../types/document'

/** 走「解析表格 → 写库」这套骨架的任务。 */
export type ApplyTableTask = 'confusable' | 'example' | 'phrase' | 'grammar_mark' | 'lemma' | 'pos'

/** 会产生「AI 没返回这几个词」清单的任务（example 是纯追加，不存在漏项）。 */
export type ApplyMissingTask = Exclude<ApplyTableTask, 'example'>

export interface ApplyTableOutcome {
  /** 应用后的词库；null = 没有可写的改动（调用方别落库） */
  next: VocabLibrary | null
  report: string[]
  missing: { task: ApplyMissingTask; words: string[] } | null
  ok: boolean
}

/** 回执里预览几个词：太多了界面装不下。 */
const MISSING_PREVIEW = 20
const EMPTY_PREVIEW = 10

/** 请求的词里，AI 没返回的（按 lemma 比较）。 */
export function missingWords(requested: string[], returned: string[]): string[] {
  const got = new Set(returned.map((w) => lemmaOf(w)))
  return requested.filter((w) => !got.has(lemmaOf(w)))
}

/** `a、b、c…`（超长截断）。 */
function head(words: string[], n: number): string {
  return `${words.slice(0, n).join('、')}${words.length > n ? '…' : ''}`
}

function notParsed(report: string): ApplyTableOutcome {
  return { next: null, report: [report], missing: null, ok: false }
}

/** 混淆项：写到对应词条，供选择题当干扰项。先校验再落库。 */
function applyConfusable(text: string, lib: VocabLibrary, askedWords: string[]): ApplyTableOutcome {
  const parsed = parseConfusables(text)
  if (!parsed.length) return notParsed('没解析出混淆项（格式：原词 | 词:释义 ; 词:释义）')
  const libLemmas = new Set(lib.items.map((it) => it.lemma))
  // 「易混词」为空、或就是自己 → 内容无效
  const valid = parsed
    .map((r) => ({
      ...r,
      confusables: r.confusables.filter((c) => c.word.trim() && lemmaOf(c.word) !== lemmaOf(r.word)),
    }))
    .filter((r) => r.confusables.length > 0)
  const applied = valid.filter((r) => libLemmas.has(lemmaOf(r.word)))
  const unknown = valid.filter((r) => !libLemmas.has(lemmaOf(r.word))).map((r) => r.word)
  const empty = parsed
    .filter((r) => r.confusables.every((c) => !c.word.trim() || lemmaOf(c.word) === lemmaOf(r.word)))
    .map((r) => r.word)
  const missing = missingWords(askedWords, valid.map((r) => r.word))

  const report: string[] = [`成功写入 ${applied.length} 个词的混淆项`]
  if (missing.length) report.push(`AI 未返回 ${missing.length} 个：${head(missing, MISSING_PREVIEW)}`)
  if (empty.length) report.push(`内容无效 ${empty.length} 个（缺有效易混词）：${head(empty, EMPTY_PREVIEW)}`)
  if (unknown.length) report.push(`词库里没有 ${unknown.length} 个：${head(unknown, EMPTY_PREVIEW)}`)
  return {
    next: applied.length ? applyConfusables(lib, applied) : null,
    report,
    missing: missing.length ? { task: 'confusable', words: missing } : null,
    ok: true,
  }
}

/** 用法示例：按中文含义给词补例句（英+中）。 */
function applyExample(text: string, lib: VocabLibrary): ApplyTableOutcome {
  const rows = parseExampleTable(text)
  if (!rows.length) return notParsed('没解析出例句（格式：单词 | 英 | 中 | 英 | 中）')
  return {
    next: applyExamples(lib, rows),
    report: [`已加入 ${rows.length} 个词的例句`],
    missing: null,
    ok: true,
  }
}

/** 词组 / 习语：给词补「词组」「习语」两块（与用法、例句分开）。 */
function applyPhrase(text: string, lib: VocabLibrary, askedWords: string[]): ApplyTableOutcome {
  const rows = parsePhraseTable(text)
  if (!rows.length) return notParsed('没解析出词组/习语（格式：单词 | 词组1；词组2 | 习语1；习语2）')
  const missing = missingWords(askedWords, rows.map((r) => r.word))
  const report = [`已写入 ${rows.length} 个词组的词组/习语`]
  if (missing.length) report.push(`AI 未返回 ${missing.length} 个：${head(missing, MISSING_PREVIEW)}`)
  return {
    next: applyPhrases(lib, rows),
    report,
    missing: missing.length ? { task: 'phrase', words: missing } : null,
    ok: true,
  }
}

/** 语法标记：给名词/动词/形容词标「可数性 / 及物性」等。 */
function applyGrammarMark(text: string, lib: VocabLibrary, askedWords: string[]): ApplyTableOutcome {
  const rows = parseGrammarMarkTable(text)
  if (!rows.length)
    return notParsed('没解析出语法标记（格式：单词 | 标记1；标记2，标记取可数/不可数/及物/不及物…）')
  const missing = missingWords(askedWords, rows.map((r) => r.word))
  const report = [`已标注 ${rows.length} 个词的语法标记`]
  if (missing.length) report.push(`AI 未返回 ${missing.length} 个：${head(missing, MISSING_PREVIEW)}`)
  return {
    next: applyGrammarMarks(lib, rows),
    report,
    missing: missing.length ? { task: 'grammar_mark', words: missing } : null,
    ok: true,
  }
}

/** 原形校正：改 word/lemma，再合并重复。 */
function applyLemma(text: string, lib: VocabLibrary, askedWords: string[]): ApplyTableOutcome {
  const pairs = parseLemmaTable(text)
  if (!pairs.length) return notParsed('没解析出原形（格式：原词形 | 原形）')
  const before = lib.items.length
  const next = dedupeLibrary(applyLemmaMap(lib, pairs))
  const changed = pairs.filter((p) => normalizeWord(p.from) !== normalizeWord(p.to)).length
  const merged = before - next.items.length
  const report: string[] = [`校正 ${changed} 个词形（共 ${pairs.length} 行）`]
  if (merged > 0) report.push(`合并去重 ${merged} 个`)
  const missing = missingWords(askedWords, pairs.map((p) => p.from))
  if (missing.length) report.push(`AI 未返回 ${missing.length} 个：${head(missing, MISSING_PREVIEW)}`)
  return { next, report, missing: missing.length ? { task: 'lemma', words: missing } : null, ok: true }
}

/** -ing/-ed 语法辨析：写回原形 / 词性 / 笔记。 */
function applyPos(text: string, lib: VocabLibrary, askedWords: string[]): ApplyTableOutcome {
  const rows = parsePosTable(text)
  if (!rows.length)
    return notParsed('没解析出辨析结果（应为 8 列：原形 | 当前形式 | … | 最准确词性标注）')
  const before = lib.items.length
  const next = dedupeLibrary(applyPosAnalysis(lib, rows))
  const merged = before - next.items.length
  // 这里的「返回了吗」按词形比：AI 给的是当前形式（running），请求里可能是原形或短语
  const surfaces = rows.map((r) => normalizeWord(r.surface)).filter(Boolean)
  const missing = askedWords.filter((w) => {
    const nw = normalizeWord(w)
    return !surfaces.some((s) => nw === s || nw.split(' ').includes(s))
  })
  const report: string[] = [`已写回 ${rows.length} 条辨析`]
  if (merged > 0) report.push(`合并去重 ${merged} 个`)
  if (missing.length) report.push(`AI 未覆盖 ${missing.length} 个：${head(missing, MISSING_PREVIEW)}`)
  return { next, report, missing: missing.length ? { task: 'pos', words: missing } : null, ok: true }
}

/** 按任务分派。`text` 已 trim；空串由调用方挡掉。 */
export function applyTableTask(
  task: ApplyTableTask,
  text: string,
  lib: VocabLibrary,
  askedWords: string[],
): ApplyTableOutcome {
  switch (task) {
    case 'confusable':
      return applyConfusable(text, lib, askedWords)
    case 'example':
      return applyExample(text, lib)
    case 'phrase':
      return applyPhrase(text, lib, askedWords)
    case 'grammar_mark':
      return applyGrammarMark(text, lib, askedWords)
    case 'lemma':
      return applyLemma(text, lib, askedWords)
    case 'pos':
      return applyPos(text, lib, askedWords)
  }
}
