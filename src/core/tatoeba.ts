/**
 * 离线例句（数据来自 Tatoeba，经 tools/build-tatoeba.mjs 预处理）。
 *
 * 纯逻辑：解析紧凑 TSV（`word ⇥ en ⇥ zh`）、按词查例句。网络加载在 adapters/tatoeba.ts。
 * 数据文件不存在时所有调用方自动降级（返回空），不影响其它功能。
 */

export interface ExampleSentence {
  /** 英文例句 */
  en: string
  /** 中文翻译 */
  zh: string
}

export interface Tatoeba {
  /** lower(word) → 例句（每个词最多几条，构建时已按句长排序） */
  byWord: Map<string, ExampleSentence[]>
}

/** 解析构建脚本产出的 TSV。cap = 每个词最多保留几条。 */
export function parseTatoeba(tsv: string, cap = 6): Tatoeba {
  const byWord = new Map<string, ExampleSentence[]>()
  for (const line of tsv.split('\n')) {
    if (!line) continue
    const c = line.split('\t')
    if (c.length < 3) continue
    const w = c[0].trim().toLowerCase()
    const en = c[1].trim()
    const zh = c[2].trim()
    if (!w || !en) continue
    const arr = byWord.get(w)
    if (arr) {
      if (arr.length >= cap || arr.some((x) => x.en === en)) continue
      arr.push({ en, zh })
    } else {
      byWord.set(w, [{ en, zh }])
    }
  }
  return { byWord }
}

/** 按词形 / 原形查例句（先词形、后原形）。查不到返回 []。 */
export function examplesFor(t: Tatoeba, word: string, lemma?: string): ExampleSentence[] {
  const keys = [word.trim().toLowerCase(), (lemma ?? '').trim().toLowerCase()]
  for (const k of keys) {
    if (!k) continue
    const hit = t.byWord.get(k)
    if (hit?.length) return hit
  }
  return []
}
