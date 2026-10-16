/**
 * 「正文里哪些词算生词」这一层（纯函数）。
 *
 * 正文高亮 / 编号 / a·d 跳转都靠这几个集合，规则一旦飘就会「明明有词却不亮」。
 * 抽出来单测钉住：
 *   - `sentenceLemmaSets`：每句里出现过的 lemma
 *   - `allLemmas`：全文出现过的 lemma
 *   - `activeLemmasOf`：**未掌握**词条的词形与 lemma（a/d 只在这些句间跳）
 *   - `vocabSentenceIds`：有生词的句子（按正文顺序）—— 含「待选清单里指到过的句子」
 */
import type { Sentence, VocabItem } from '../types/document'
import { lemmaOf, normalizeWord } from './vocab'
import { wordSpans } from './wordSelect'

export function sentenceLemmaSets(sentences: Pick<Sentence, 'id' | 'text'>[] | null | undefined): Map<string, Set<string>> {
  const m = new Map<string, Set<string>>()
  for (const s of sentences ?? []) {
    const set = new Set<string>()
    for (const w of wordSpans(s.text)) set.add(lemmaOf(w.text))
    m.set(s.id, set)
  }
  return m
}

export function allLemmas(sets: Map<string, Set<string>>): Set<string> {
  const all = new Set<string>()
  for (const set of sets.values()) for (const l of set) all.add(l)
  return all
}

/** 未掌握词条的词形/lemma（正文里据此标"生词"）。 */
export function activeLemmasOf(items: VocabItem[]): Set<string> {
  const s = new Set<string>()
  for (const it of items) {
    if (it.status === 'mastered') continue
    s.add(normalizeWord(it.word))
    s.add(it.lemma)
  }
  return s
}

/** 正文里所有词条的词形/lemma（含已掌握：用于「已在生词本里」的显示）。 */
export function libraryLemmaSet(items: VocabItem[]): Set<string> {
  const s = new Set<string>()
  for (const it of items) {
    s.add(it.word.toLowerCase())
    s.add(it.lemma)
  }
  return s
}

/**
 * 有生词的句子 id（正文顺序）。
 * 判据：这句里有「未掌握的词」**或**这句被待选清单指到过（`batchSentenceIds`）。
 */
export function vocabSentenceIds(
  sentences: Pick<Sentence, 'id' | 'text'>[] | null | undefined,
  sentenceLemmas: Map<string, Set<string>>,
  activeLemmas: Set<string>,
  batchSentenceIds: Set<string>,
): string[] {
  const out: string[] = []
  for (const s of sentences ?? []) {
    if (batchSentenceIds.has(s.id)) {
      out.push(s.id)
      continue
    }
    const set = sentenceLemmas.get(s.id)
    if (!set) continue
    for (const l of set) {
      if (activeLemmas.has(l)) {
        out.push(s.id)
        break
      }
    }
  }
  return out
}
