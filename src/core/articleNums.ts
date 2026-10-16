/**
 * 正文里的「生词编号」规则（纯函数）。
 *
 * 规则（原样保留历史行为，现在有测试钉住）：
 *   1. 按**手动标记顺序**（`createdAt` 升序）编号 —— 先标的在前；
 *   2. 同一时刻批量加入的（如「自动标词」一次入库）`createdAt` 相同，则退回到**正文出现顺序**；
 *   3. 再不行按 lemma 字母序兜底（保证稳定，不随词库顺序抖动）；
 *   4. 编号**按篇独立**，跨篇重置；
 *   5. `firstOccurrence` 给出「某个词在正文首次出现的位置」（`句子id:词序号`），
 *      正文只在这一处显示上标编号。
 */
import type { Sentence, VocabItem } from '../types/document'
import { lemmaOf } from './vocab'
import { wordSpans } from './wordSelect'

export interface ArticleNumbering {
  /** lemma → 编号（从 1 开始） */
  nums: Map<string, number>
  /** 正文首次出现的位置集合（`sid:wordIndex`） */
  firstOccurrence: Set<string>
}

export function articleNumbering(
  sentences: Pick<Sentence, 'id' | 'text'>[] | null | undefined,
  items: VocabItem[],
): ArticleNumbering {
  const nums = new Map<string, number>()
  const firstOccurrence = new Set<string>()
  if (!sentences?.length) return { nums, firstOccurrence }

  const byLemma = new Map<string, VocabItem>()
  for (const it of items) byLemma.set(it.lemma, it)

  // 每个 lemma 在正文的首次出现位置与出现顺序
  const docOrder = new Map<string, number>()
  for (const s of sentences) {
    wordSpans(s.text).forEach((w, i) => {
      const lem = lemmaOf(w.text)
      if (byLemma.has(lem) && !docOrder.has(lem)) {
        docOrder.set(lem, docOrder.size)
        firstOccurrence.add(`${s.id}:${i}`)
      }
    })
  }

  const ordered = [...items].sort(
    (a, b) =>
      a.createdAt.localeCompare(b.createdAt) ||
      (docOrder.get(a.lemma) ?? 1e9) - (docOrder.get(b.lemma) ?? 1e9) ||
      a.lemma.localeCompare(b.lemma),
  )
  ordered.forEach((it, i) => nums.set(it.lemma, i + 1))
  return { nums, firstOccurrence }
}
