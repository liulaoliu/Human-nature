import type { Sentence } from '../types/document'
import { getSentenceLanguages } from './language'
import { splitGlossText } from './langPoints'

/**
 * 「语言点造句」的可选项：本句语言点里的**词块**（phrases / idioms）。
 *
 * 为什么只要这两类：造句要求「必须用上 X」，X 得是能直接写进英文句子的片段；
 * `usage` 是中文说明（“so-called 常带保留态度”），`structure/grammar` 是整句规则，
 * 它们已经在「整句仿写」的 targets 里覆盖了，单独拎出来没法当 mustUse。
 *
 * 纯函数：只读本句 + 已练过的 focus 集合，不碰词库、不碰存储。
 */
export interface LangPointChoice {
  /** 必须用上的英文片段 */
  en: string
  /** 中文释义（语言点里带就带，没有就不显示） */
  zh?: string
  /** 这一句里已经练过（`writingHistory` 里有同句同 focus 的记录） */
  done: boolean
}

const keyOf = (s: string) => s.replace(/\s+/g, ' ').trim().toLowerCase()

/** 本句可单练的语言点，按语言点出现顺序去重；没有就返回空数组。 */
export function langPointChoices(
  sentence: Pick<Sentence, 'language' | 'languages'> | null | undefined,
  doneFocus?: ReadonlySet<string>,
): LangPointChoice[] {
  if (!sentence) return []
  const done = doneFocus ?? new Set<string>()
  const seen = new Set<string>()
  const out: LangPointChoice[] = []
  for (const L of getSentenceLanguages(sentence as Sentence)) {
    for (const raw of [...(L.phrases ?? []), ...(L.idioms ?? [])]) {
      const { word, gloss } = splitGlossText(raw)
      const en = word.trim()
      if (!en) continue
      const k = keyOf(en)
      if (seen.has(k)) continue
      seen.add(k)
      out.push({ en, ...(gloss ? { zh: gloss } : {}), done: done.has(k) })
    }
  }
  return out
}

/** 从记录里捞出「同篇同句、已经练过的 focus」。 */
export function doneLangPoints(
  records: ReadonlyArray<{ articleId: string; sentenceId?: string; task?: { focus?: string } | null }>,
  articleId: string,
  sentenceId: string,
): Set<string> {
  const out = new Set<string>()
  for (const r of records) {
    if (r.articleId !== articleId || r.sentenceId !== sentenceId) continue
    const focus = r.task?.focus
    if (focus) out.add(keyOf(focus))
  }
  return out
}

/** focus 的比较口径（大小写 / 空白不敏感）。 */
export function langPointKey(text: string): string {
  return keyOf(text)
}
