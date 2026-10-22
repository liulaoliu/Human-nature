import type { VocabItem } from '../../types/document'
import { displayMeaning } from './word'

/**
 * 「选中文释义」的四个选项（纯函数）。
 *
 * 以前这段写在 `panels/StudyDrill` 里，但会话要知道「正确项是第几个」
 * （学习模式揭示答案时要给正确项上浅绿），规则就不能只活在视图层：
 * 两边各算一份，顺序迟早会不一致。
 *
 * 选项顺序用**卡 id 做种子的稳定哈希**排：同一张卡每次出场顺序都一样，
 * 不会因为词库增删而跳来跳去（否则用户会以为"正确答案换了位置"）。
 */

/** FNV-1a：够快、够散，同一字符串永远得同一个数。 */
function hash(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619)
  return h >>> 0
}

export interface MeaningOption {
  text: string
  correct: boolean
}

/** 正确释义 + 3 个来自其它词的释义（同义去重）。词库不足时返回空数组（调用方退回普通卡）。 */
export function meaningOptions(card: VocabItem, items: VocabItem[]): MeaningOption[] {
  const correct = displayMeaning(card)
  if (!correct) return []
  const pool = [...new Set(items.filter((it) => it.id !== card.id).map((it) => displayMeaning(it)).filter(Boolean))].filter(
    (m) => m !== correct,
  )
  const picked = pool
    .map((m) => ({ m, k: hash(card.id + '|' + m) }))
    .sort((a, b) => a.k - b.k)
    .slice(0, 3)
    .map((x) => x.m)
  if (picked.length < 3) return []
  return [correct, ...picked]
    .map((t) => ({ t, correct: t === correct, k: hash(card.id + '#' + t) }))
    .sort((a, b) => a.k - b.k)
    .map(({ t, correct: c }) => ({ text: t, correct: c }))
}

/** 正确项的下标；出不了题（词库不足）时是 -1。 */
export function correctOptionIndex(card: VocabItem, items: VocabItem[]): number {
  return meaningOptions(card, items).findIndex((o) => o.correct)
}
