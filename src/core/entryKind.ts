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

/** 词条类型（老数据没有 `kind` → 普通单词）。 */
export function kindOf(item: { kind?: VocabKind } | null | undefined): VocabKind {
  return item?.kind ?? 'word'
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

/** 能不能拿来背 / 考（用法笔记是中文说明，只用来收藏与打印）。 */
export function isStudyable(item: { kind?: VocabKind } | null | undefined): boolean {
  return kindOf(item) !== 'usage'
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
