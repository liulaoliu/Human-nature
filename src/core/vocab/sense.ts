/**
 * 一条词卡的「义项一致性」：词性、中文释义、英英释义必须说的是**同一个义项**。
 *
 * 三类数据在这里汇合，谁的话更可靠是不一样的：
 *   - AI 查词：看过**这句话**，词性/释义/搭配/例句是同一行答案 → 可信，成组写入；
 *   - 离线词典（ECDICT / M-W）：只有**词头首义**的词性和释义 → 只能占位，不能单独定词性；
 *   - 用户手改：一律不动。
 *
 * 所以这个文件只做机械可判的裁决，不做语义猜测：
 *   1. `reconcileSense`：释义自带词性标记（"n. 誓约" / "vt. 引起"）时它是硬证据，词性跟它走；
 *   2. `senseConflict`：把「词典占位的词性 + AI 的语境释义」这种必然可能打架的组合标出来，
 *      由写入方决定清掉还是重查（`tool/check_vocab_sense.mjs` 用它做门禁）。
 */
import type { VocabItem } from '../../types/document'

/** 词性写法 → 归类。认不出来的原样返回（gate 会把它当异常）。 */
const CLASS: Record<string, string> = {
  n: 'n',
  noun: 'n',
  v: 'v',
  vt: 'v',
  vi: 'v',
  verb: 'v',
  a: 'adj',
  adj: 'adj',
  adjective: 'adj',
  ad: 'adv',
  adv: 'adv',
  adverb: 'adv',
  prep: 'prep',
  preposition: 'prep',
  conj: 'conj',
  conjunction: 'conj',
  pron: 'pron',
  pronoun: 'pron',
  num: 'num',
  numeral: 'num',
  art: 'art',
  article: 'art',
  interj: 'interj',
  interjection: 'interj',
}

/** 归类词性；`v./n.` 这种并写取第一个认得的。 */
export function posClassOf(pos: string | null | undefined): string {
  const raw = String(pos ?? '')
    .trim()
    .toLowerCase()
    .replace(/\.+$/, '')
  if (!raw) return ''
  if (CLASS[raw]) return CLASS[raw]
  for (const part of raw.split(/[/、,，]/)) {
    const key = part.trim().replace(/\.+$/, '')
    if (CLASS[key]) return CLASS[key]
  }
  return raw
}

/** 释义开头的词性标记（"n. 誓约" / "vt. 引起"）→ 规范缩写；没有就 null。 */
export function posFromGloss(meaning: string | null | undefined): string | null {
  const m = /^([a-z]{1,6})\.\s*\S/i.exec(String(meaning ?? '').trim())
  if (!m) return null
  const cls = CLASS[m[1].toLowerCase()]
  if (!cls) return null
  return cls === 'adj' ? 'adj.' : `${cls}.`
}

/** 只有「单词卡片」才有词性可言：词组 / 用法笔记（kind 非空或 word 带空格）不在这一套里。 */
export function isWordCard(item: { word: string; kind?: string | null }): boolean {
  if (item.kind) return false
  return !String(item.word ?? '').trim().includes(' ')
}

/**
 * 让词性跟释义对齐：释义带着词性标记（那份释义就是这么标的）时，以标记为准。
 * 用户手填的词性不动（`fieldSources.partOfSpeech === 'manual'`）。
 */
export function reconcileSense(item: VocabItem): VocabItem {
  if (!isWordCard(item)) return item
  if (item.fieldSources?.partOfSpeech === 'manual') return item
  const fromGloss = posFromGloss(item.meaning)
  if (!fromGloss) return item
  if (item.partOfSpeech && posClassOf(item.partOfSpeech) === posClassOf(fromGloss)) return item
  return {
    ...item,
    partOfSpeech: fromGloss,
    fieldSources: {
      ...item.fieldSources,
      // 释义是 AI 给的，说明这个标记出自 AI 那行答案；否则只能是词典行
      partOfSpeech: item.fieldSources?.meaning === 'ai' ? 'ai' : 'dict',
    },
  }
}

/** 自相矛盾的地方（没有就 null）。给门禁/体检用，写作时也会被 `reconcileSense` 挡住一部分。 */
export function senseConflict(item: VocabItem): 'dict-pos-with-ai-meaning' | 'pos-gloss-mismatch' | null {
  if (!isWordCard(item)) return null
  const posSrc = item.fieldSources?.partOfSpeech
  const meaningSrc = item.fieldSources?.meaning
  // 词典给的词性是词头首义，AI 给的释义是语境义：这一对天然可能说的不是一回事
  if (item.partOfSpeech && posSrc === 'dict' && meaningSrc === 'ai') return 'dict-pos-with-ai-meaning'
  const fromGloss = posFromGloss(item.meaning)
  if (fromGloss && item.partOfSpeech && posClassOf(fromGloss) !== posClassOf(item.partOfSpeech)) {
    return 'pos-gloss-mismatch'
  }
  return null
}
