import type { VocabLibrary } from '../../types/document'
import { reviewItem } from './review'

/**
 * 拼写判定的规则（纯函数）。
 *
 * 产品口径：拼写是「能不能写出来」的硬门槛，不宽容、不重试。
 * 错一次就判「不认识」：SRS 记 again（进入重学）、打上「不认识」标签，
 * 由会话把它重排回队列，从头走一遍学习流程。
 */

/** 判为不认识时打的标签（与「不认识」按钮一致）。 */
export const SPELLING_MISS_TAG = '不认识'

/**
 * 拼写比对：忽略大小写与首尾/连续空格，**不忽略字母错误**。
 * 不用 `lemmaOf` 兜底：拼成别的词形（ran / run）在拼写题里就是错。
 */
export function spellingMatches(input: string, word: string): boolean {
  const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ')
  return norm(input) === norm(word)
}

/**
 * 拼错后的词库：记 again（repetitions 归零 + 进入重学）并打「不认识」标签。
 * 只改这一条，其它条目保持原引用。
 */
export function markSpellingMiss(library: VocabLibrary, id: string, now: Date = new Date()): VocabLibrary {
  const reviewed = reviewItem(library, id, 'again', now)
  return {
    ...reviewed,
    items: reviewed.items.map((it) =>
      it.id === id && !it.tags.includes(SPELLING_MISS_TAG)
        ? { ...it, tags: [...it.tags, SPELLING_MISS_TAG] }
        : it,
    ),
  }
}
