import type { ListeningQuestion } from './listening'

/**
 * 统一「错题本」：把考试错词、听力错题、听写漏词都收进来，随时重练。
 *
 * 纯函数，方便单测；存储是一串条目，落 localStorage。
 * 同一实体（同词 / 同题 / 同段）只留一条，重复错则累加 count、刷新时间。
 */

export type MistakeKind = 'vocab' | 'listen' | 'dict'

export const MISTAKE_LABEL: Record<MistakeKind, string> = {
  vocab: '考试错词',
  listen: '听力错题',
  dict: '听写漏词',
}

export interface MistakeEntry {
  /** 唯一键（kind:实体） */
  id: string
  kind: MistakeKind
  /** 最近一次错的时间（ISO） */
  at: string
  /** 累计错次 */
  count: number
  /** 显示用标签 */
  label: string
  /** 考试错词：词条 id */
  itemId?: string
  /** 听力错题：题目（含答案/解析） */
  question?: ListeningQuestion
  /** 听力错题：来源文章 */
  articleId?: string
  /** 听写漏词：原文片段 */
  text?: string
}

function normText(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, ' ')
}

export function vocabMistake(itemId: string, label: string, at: string): MistakeEntry {
  return { id: `vocab:${itemId}`, kind: 'vocab', at, count: 1, label, itemId }
}
export function listenMistake(articleId: string, q: ListeningQuestion, at: string): MistakeEntry {
  // id 用「题号 + 题干」，不带文章：错题本重练时文章可能不同，也能对上
  return {
    id: `listen:${q.id}:${normText(q.stem)}`,
    kind: 'listen',
    at,
    count: 1,
    label: q.stem,
    question: q,
    articleId,
  }
}
export function dictMistake(text: string, at: string): MistakeEntry {
  return { id: `dict:${normText(text)}`, kind: 'dict', at, count: 1, label: text, text }
}

/** 加入 / 累加一条错题（同 id 合并，新的在前，按上限截断）。纯函数。 */
export function upsertMistake(list: MistakeEntry[], entry: MistakeEntry, cap = 300): MistakeEntry[] {
  const i = list.findIndex((m) => m.id === entry.id)
  if (i < 0) return [entry, ...list].slice(0, Math.max(0, cap))
  const next = [...list]
  next[i] = { ...entry, count: (list[i].count ?? 0) + 1 }
  return next
}

/** 移除一条（答对后清掉）。 */
export function removeMistake(list: MistakeEntry[], id: string): MistakeEntry[] {
  return list.filter((m) => m.id !== id)
}

/** 各类数量。 */
export function mistakeCounts(list: MistakeEntry[]): Record<MistakeKind, number> {
  const out: Record<MistakeKind, number> = { vocab: 0, listen: 0, dict: 0 }
  for (const m of list) out[m.kind] += 1
  return out
}
