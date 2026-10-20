import type { Sentence } from '../types/document'

/**
 * 「当前操作对象是哪一句 / 用哪段文字」—— 提示词、翻译、复制、TTS 全走这里。
 *
 * 从 `ReaderApp` 抽出来的原因：规则就三行，但**三个地方**（AI 任务、导出、选区面板）
 * 都以为自己知道，一旦某处写歪（比如忘记「有精确选区就优先用选区」），
 * 复制的文本和朗读的内容就对不上。抽成纯函数是为了能直接测。
 */

/** 选一句：先看显式选中的 id，再看精确选区落在哪句里，都没有就 null */
export function pickSentence(
  sentences: readonly Sentence[] | null | undefined,
  selectedId: string | null,
  exact: string,
): Sentence | null {
  if (!sentences) return null
  if (selectedId) {
    const s = sentences.find((x) => x.id === selectedId)
    if (s) return s
  }
  if (exact) return sentences.find((x) => x.text.includes(exact)) ?? null
  return null
}

/**
 * 实际拿去用的文本：勾了「用选区」且选区非空 → 用选区；
 * 否则用整句；连句子都没有就退回选区（可能只选了散词）。
 */
export function pickTarget(exact: string, useExact: boolean, sentence: Sentence | null): string {
  if (useExact && exact) return exact
  return sentence?.text || exact
}
