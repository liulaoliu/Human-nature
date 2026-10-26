/**
 * 词条「类型」这一层的小工具。
 *
 * 为什么单独一个文件：`kind` 是**跨领域**的概念——词库（单词）、语言点（词组/习语/用法）、
 * 打印导出、AI 任务、背单词范围都要问「这条是哪一类」。放在 vocab.ts 里会让所有想用它的
 * 模块（包括 aiPackage）都被迫依赖整个词库逻辑。这里零依赖，谁都能引。
 *
 * 分层约定见 docs/ARCHITECTURE.md。
 */
import type { VocabItem, VocabKind } from '../types/document'

/** 含中日韩文字（用法笔记基本都是中文说明）。 */
const CJK = /[\u3400-\u9fff\u3040-\u30ff\uac00-\ud7af]/

/**
 * 词条正文本身就是一个英文单词（可带连字符 / 撇号，不含空格与中文）。
 *
 * 为什么单独拎出来：AI 有时把单词写进「词组 / 用法」栏，历史上也留下过
 * 「单词词条被标成 usage」的脏数据。词形是单个英文单词时，类型只能是单词。
 */
export function isSingleEnglishWord(text: string | null | undefined): boolean {
  const w = (text ?? '').trim()
  if (!w || CJK.test(w)) return false
  return /^[A-Za-z][A-Za-z'’\-]*$/.test(w)
}

/**
 * 词条类型（老数据没有 `kind` → 普通单词）。
 *
 * 同时兜住「类型与词形矛盾」的存量数据：`word` 是单个英文单词却标成
 * `phrase / idiom / usage` 时按单词算。否则这些词会从「本篇生词」里消失、
 * 一键处理反复把它们塞回待选（Profits overboard 的 conglomerate / reckon / scrap）。
 */
export function kindOf(item: { kind?: VocabKind; word?: string } | null | undefined): VocabKind {
  const kind = item?.kind ?? 'word'
  if (kind === 'word') return 'word'
  return isSingleEnglishWord(item?.word) ? 'word' : kind
}

/** 类型的中文名（列表标签、打印、Anki 标签用）。 */
export const KIND_LABEL: Record<VocabKind, string> = {
  word: '单词',
  phrase: '词组',
  idiom: '习语',
  usage: '用法',
}

export const KIND_ORDER: VocabKind[] = ['word', 'phrase', 'idiom', 'usage']

/** 是不是「单词」——词组 / 习语 / 用法笔记都不是（AI 的词级任务不该去分析它们）。 */
export function isWordEntry(item: { kind?: VocabKind } | null | undefined): boolean {
  return kindOf(item) === 'word'
}

/** 是不是「语言点收藏」（词组 / 习语 / 用法笔记）。 */
export function isLangPoint(item: { kind?: VocabKind } | null | undefined): boolean {
  return kindOf(item) !== 'word'
}

/** 能不能拿来背 / 考。两条硬门槛：
 *  - 用法笔记（中文说明）只用来收藏与打印，不进卡片；
 *  - 没有释义的卡是「废卡」（`aiTodos` 里说的「查过但没给」也在这）——没中文意思，
 *    选义题出不了、卡片上只能显示「无释义」，不该混进背词 / 考试池，先去补释义。
 */
export function isStudyable(item: { kind?: VocabKind; meaning?: string | null } | null | undefined): boolean {
  if (kindOf(item) === 'usage') return false
  return !!item?.meaning
}

/** 背词牌组：普通单词 / 搭配（词组·习语）。 */
export type StudyDeck = 'word' | 'collocation'

/**
 * 这条属于哪个背词牌组。
 * - word：只背普通单词（词组/习语抽到「背搭配」里）
 * - collocation：只背词组 / 习语（用法笔记两边都不进）
 */
export function inStudyDeck(
  item: { kind?: VocabKind; meaning?: string | null } | null | undefined,
  deck: StudyDeck,
): boolean {
  if (!isStudyable(item)) return false
  const k = kindOf(item)
  return deck === 'collocation' ? k === 'phrase' || k === 'idiom' : k === 'word'
}

/** 按类型筛（不传 / 空数组 = 全部）。 */
export function filterByKind(items: VocabItem[], kinds?: VocabKind[] | null): VocabItem[] {
  if (!kinds?.length) return items
  const set = new Set(kinds)
  return items.filter((it) => set.has(kindOf(it)))
}

/** 纯单词。 */
export function wordEntries(items: VocabItem[]): VocabItem[] {
  return items.filter(isWordEntry)
}

/** 语言点收藏（词组 / 习语 / 用法）。 */
export function langEntries(items: VocabItem[]): VocabItem[] {
  return items.filter(isLangPoint)
}
