/**
 * 「这个词在这一篇 / 这一句里是什么意思」的解析顺序（纯函数）。
 *
 * 目标：悬浮释义优先用本篇语境，不拿别的文章的主释义硬套。
 * 顺序固定为：
 *   1. 本篇条目上手改/收录时带的释义（最高，不被 AI 覆盖）
 *   2. 同一句的语境释义（`contexts[].meaning`，AI 按上下文给的）
 *   3. 同一篇其他句子的语境释义
 *   4. 全库主释义（最后兜底）
 *
 * 不在这里调词典 / AI：那些是显式动作，结果写回 `contexts` / 条目后再走这里。
 */
import type {
  ArticleVocabEntry,
  VocabContext,
  VocabItem,
  VocabMeaningSource,
} from '../types/document'

export interface ResolvedMeaning {
  text: string
  source: VocabMeaningSource
}

/** 释义来源的显示文案（本篇条目 / 悬浮解释共用）。 */
export const MEANING_SOURCE_LABEL: Record<VocabMeaningSource, string> = {
  manual: '手动',
  context: '语境',
  library: '词库',
  dict: '词典',
  ai: 'AI',
}

export function meaningSourceLabel(source: VocabMeaningSource | undefined | null): string | null {
  return source ? MEANING_SOURCE_LABEL[source] : null
}

function contextMatches(c: VocabContext, articleId: string): boolean {
  return c.fileName === articleId || c.articleId === articleId
}

function contextMeaning(list: VocabContext[] | undefined, articleId: string, sentenceId?: string | null): VocabContext | null {
  if (!list?.length || !articleId) return null
  for (let i = list.length - 1; i >= 0; i--) {
    const c = list[i]
    if (!c.meaning?.trim() || !contextMatches(c, articleId)) continue
    if (sentenceId && c.sentenceId === sentenceId) return c
  }
  for (let i = list.length - 1; i >= 0; i--) {
    const c = list[i]
    if (c.meaning?.trim() && contextMatches(c, articleId)) return c
  }
  return null
}

export function resolveArticleMeaning(
  item: VocabItem,
  entry: ArticleVocabEntry | null | undefined,
  articleId: string,
  sentenceId?: string | null,
): ResolvedMeaning | null {
  const own = entry?.meaning?.trim()
  if (own) return { text: own, source: entry?.meaningSource ?? 'manual' }

  const ctx = contextMeaning(item.contexts, articleId, sentenceId)
  if (ctx?.meaning?.trim()) return { text: ctx.meaning.trim(), source: 'context' }

  const main = item.meaning?.trim()
  if (main) return { text: main, source: 'library' }
  return null
}
