/**
 * 「AI 漏掉的词」重新组提示词：一种任务一个构建函数。
 *
 * 以前这段在 `ReaderApp.copyMissingAgain` 里是 5 个 if 分支，每个都重复
 * 「从词库取词 → 组 entries → 设置 ref → setLastTask → 写剪贴板」。
 * 现在映射和构建都收在这里，ReaderApp 只剩一行调用；新增任务只改这张表。
 */
import type { VocabItem } from '../types/document'
import { lemmaOf } from '../core/vocab'
import {
  buildBatchLookupPrompt,
  buildConfusablePrompt,
  buildGrammarMarkPrompt,
  buildLemmaPrompt,
  buildPhrasePrompt,
  buildPosPrompt,
} from '../core/analyzer'

export type MissingTask = 'confusable' | 'lookup' | 'lemma' | 'pos' | 'phrase' | 'grammar_mark'

type LookupItem = Pick<VocabItem, 'lemma' | 'word' | 'meaning' | 'source'>

/**
 * 按任务类型把缺失词重新组成提示词。
 * `items` 传当前词库；找不到的词用原始拼写，不丢。
 */
export function buildMissingPrompt(task: MissingTask, words: string[], items: LookupItem[]): string {
  const byLemma = new Map(items.map((it) => [it.lemma, it]))
  const at = (w: string) => byLemma.get(lemmaOf(w))

  switch (task) {
    case 'confusable':
      return buildConfusablePrompt(
        words.map((w) => {
          const it = at(w)
          return { word: it?.word ?? w, meaning: it?.meaning ?? null }
        }),
      )
    case 'lemma':
    case 'pos':
      return (task === 'lemma' ? buildLemmaPrompt : buildPosPrompt)(
        words.map((w) => {
          const it = at(w)
          return { word: it?.word ?? w, context: it?.source?.sentenceText }
        }),
      )
    case 'phrase':
      return buildPhrasePrompt(
        words.map((w) => {
          const it = at(w)
          return { word: it?.word ?? w, meaning: it?.meaning ?? null }
        }),
      )
    case 'grammar_mark':
      return buildGrammarMarkPrompt(
        words.map((w) => {
          const it = at(w)
          return { word: it?.word ?? w, meaning: it?.meaning ?? null }
        }),
      )
    case 'lookup':
    default:
      return buildBatchLookupPrompt(
        words.map((w) => {
          const it = at(w)
          return { word: it?.word ?? w, context: it?.source?.sentenceText }
        }),
      )
  }
}
