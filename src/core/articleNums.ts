/**
 * 正文里的「生词编号」规则（纯函数）。
 *
 * 规则：
 *   1. 编号只看本篇的收录条目，**按加入顺序**从 1 开始（自动标词一批按正文顺序加入）；
 *   2. 编号按篇独立，跨篇重置；
 *   3. 删除条目后由调用方传入的条目顺序自动重排，不留空号；
 *   4. `firstOccurrence` 给出「某个词在正文首次出现的位置」（`句子id:词序号`），
 *      正文只在这一处显示上标编号；
 *   5. 正文里已找不到的条目仍有编号（它还在本篇词表里），只是没有上标位置。
 */
import type { ArticleVocabEntry, Sentence } from '../types/document'
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
  entries: Pick<ArticleVocabEntry, 'lemma'>[] | null | undefined,
): ArticleNumbering {
  const nums = new Map<string, number>()
  const firstOccurrence = new Set<string>()

  // 条目顺序就是加入顺序；重复 lemma 只认第一次（防历史脏数据）
  for (const e of entries ?? []) {
    if (!e.lemma || nums.has(e.lemma)) continue
    nums.set(e.lemma, nums.size + 1)
  }
  if (!sentences?.length || !nums.size) return { nums, firstOccurrence }

  // 每个有编号的 lemma 只在正文第一次出现的位置打标
  const seen = new Set<string>()
  for (const s of sentences) {
    wordSpans(s.text).forEach((w, i) => {
      const lem = lemmaOf(w.text)
      if (!nums.has(lem) || seen.has(lem)) return
      seen.add(lem)
      firstOccurrence.add(`${s.id}:${i}`)
    })
  }
  return { nums, firstOccurrence }
}
