import type { VocabVia } from '../types/document'

/**
 * 待选 / 查词批处理里的一题：词 + 它在本篇里的来源句。
 *
 * 这个形状在 AI 任务、选词、听写、工作区之间传来传去，类型只能有一份；
 * `via` 记录来源（手动 / AI / 词典），没有来源的旧调用方可以省略。
 */
export type BatchItemLike = {
  word: string
  sentence: string
  sentenceId: string | null
  via?: VocabVia
}
