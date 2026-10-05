/**
 * M-W 学习者词典索引（数据来自 anki-english-mwld-decks，经 tools/build-mwld.mjs 预处理）。
 * 纯逻辑：解析 + 查词（可用 ECDICT 的词形→原形表先还原原形）。
 */

export interface MwldEntry {
  word: string
  /** 国际音标（真 IPA，如 əˈlaʊ） */
  phonetic: string
  pos: string
  /** 英文释义（多义用 ; 合并，词典风格） */
  en: string
}

export type Mwld = Map<string, MwldEntry>

export function parseMwld(tsv: string): Mwld {
  const m: Mwld = new Map()
  for (const line of tsv.split('\n')) {
    if (!line) continue
    const c = line.split('\t')
    if (c.length < 2) continue
    m.set(c[0].toLowerCase(), { word: c[0], phonetic: c[1] ?? '', pos: c[2] ?? '', en: c[3] ?? '' })
  }
  return m
}

/** 查词：命中原词，或经词形→原形表还原后再查。 */
export function mwldLookup(m: Mwld, word: string, forms?: Map<string, string>): MwldEntry | null {
  const lower = word.trim().toLowerCase()
  if (!lower) return null
  const direct = m.get(lower)
  if (direct) return direct
  const lemma = forms?.get(lower)
  if (lemma) return m.get(lemma) ?? null
  return null
}
