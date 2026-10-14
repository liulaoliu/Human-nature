import { isPriority } from './vocab'
import { isStable } from './mastery'
import type { MistakeEntry } from './mistakes'
import type { VocabItem } from '../types/document'

/**
 * 「错题包围战」：把**最该被围剿**的词挑出来 —— 错题本 + 优先重排 + 常错(lapses) + 学不稳。
 *
 * 说明：易混词不是目标，而是**天然干扰项**（出「词形辨析 / 英英释义（选）」时自动用上），
 * 所以这里只要挑出「欠揍的词」，题目交给考试引擎去出。
 *
 * 纯函数，可单测。
 */

export interface SiegeOptions {
  now?: Date
  /** 只围剿本篇 / 整个词库。 */
  scope?: 'article' | 'all'
  /** 限定某篇（scope='article' 时用）。 */
  articleIdentity?: string
  /** 最多收多少词（0 = 不限）。 */
  limit?: number
}

export interface SiegeItem {
  item: VocabItem
  /** 为什么被围剿（显示用，如「错过 2 次 · 优先重练」） */
  reason: string
  /** 轻重分（越大越先打） */
  score: number
}

/** 挑出该围剿的词，按轻重排序。 */
export function buildSiege(items: VocabItem[], mistakes: MistakeEntry[], opts: SiegeOptions = {}): SiegeItem[] {
  const now = opts.now ?? new Date()
  const scope = opts.scope ?? 'all'
  const byItem = new Map<string, MistakeEntry>()
  for (const m of mistakes) {
    if (m.kind !== 'vocab' || !m.itemId) continue
    const prev = byItem.get(m.itemId)
    if (!prev || m.count > prev.count) byItem.set(m.itemId, m)
  }

  const out: SiegeItem[] = []
  for (const it of items) {
    if (scope === 'article' && opts.articleIdentity && it.source?.fileName !== opts.articleIdentity) continue
    const m = byItem.get(it.id)
    const prio = isPriority(it, now)
    const lapses = it.reviewState.lapses ?? 0
    const studied = it.reviewState.repetitions > 0
    const reasons: string[] = []
    let score = 0
    if (m) {
      score += 40 + Math.min(20, (m.count - 1) * 5)
      reasons.push(`错过 ${m.count} 次`)
    }
    if (prio) {
      score += 30
      reasons.push('优先重练')
    }
    if (lapses > 0) {
      score += 15 + Math.min(15, lapses * 3)
      reasons.push(`忘记 ${lapses} 次`)
    }
    if (studied && !isStable(it)) {
      score += 10
      reasons.push('还不稳')
    }
    if (score <= 0) continue
    out.push({ item: it, reason: reasons.join(' · '), score })
  }
  out.sort((a, b) => b.score - a.score || (a.item.lemma ?? '').localeCompare(b.item.lemma ?? ''))
  const limit = opts.limit ?? 0
  return limit > 0 ? out.slice(0, limit) : out
}
