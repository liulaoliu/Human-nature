import type { VocabItem } from '../types/document'
import type { QuizQuestion } from './quiz'

/** 拷打前「先学一遍」的预习卡。 */
export interface DrillWarmupCard {
  id: string
  word: string
  phonetic?: string
  meaning?: string
  /** 词块拷打要看的：用法 / 词组 / 习语 */
  chunks: string[]
  /** 记忆拷打给一条例句当语境 */
  example?: string
}

/** 由题目反推「这轮会考到哪些词」，取词条内容做成预习卡（题目是唯一事实来源，不另写筛选）。 */
export function buildWarmupCards(
  items: VocabItem[],
  questions: QuizQuestion[],
  kind: 'memory' | 'chunk',
): DrillWarmupCard[] {
  const byId = new Map(items.map((it) => [it.id, it]))
  const seen = new Set<string>()
  const cards: DrillWarmupCard[] = []
  for (const q of questions) {
    if (seen.has(q.itemId)) continue
    seen.add(q.itemId)
    const it = byId.get(q.itemId)
    if (!it) continue
    cards.push({
      id: it.id,
      word: it.word,
      phonetic: it.phonetic ?? undefined,
      meaning: it.meaning ?? undefined,
      chunks:
        kind === 'chunk'
          ? [...(it.phrases ?? []), ...(it.idioms ?? []), ...(it.usage ?? [])].filter(Boolean).slice(0, 6)
          : [],
      example: kind === 'memory' ? (it.examples.find((e) => e.text.trim())?.text ?? undefined) : undefined,
    })
  }
  return cards
}
