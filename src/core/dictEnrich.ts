/**
 * 用**离线词典**给词条补音标 / 词性 / 中文释义 / 英英释义（纯函数，不联网、不调 AI）。
 *
 * 谁在用：
 *   - 侧栏「补齐生词本」（手动，全库补一遍）
 *   - 从正文标记/本机记录**自动找回**词条之后（补完就有释义，不用等人点）
 *
 * 只补**空着的字段**，不动已有的（用户改过的、AI 给过的都保留）；都没补到就返回同一个引用，
 * 调用方据此跳过写库（幂等）。
 */
import type { VocabFieldSources, VocabItem, VocabLibrary } from '../types/document'
import type { Ecdict } from './ecdict'
import { glossForPos, guessCompoundPos, resolveWord } from './ecdict'
import { reconcileSense } from './vocab/sense'
import { cleanGloss, normalizePos } from './vocab'

/** 英英释义（M-W 学习词典）查询：给词形返回一条；没有就 null。 */
export type MwldLookup = (word: string) => { phonetic?: string; pos?: string; en?: string } | null

export interface EnrichResult {
  library: VocabLibrary
  /** 这次补了多少条 */
  filled: number
}

export function enrichWithDict(
  library: VocabLibrary,
  dict: Ecdict,
  mwld?: MwldLookup,
  now: Date = new Date(),
): EnrichResult {
  const iso = now.toISOString()
  let filled = 0
  let changed = false
  const items = library.items.map((it) => {
    const hit = resolveWord(dict, it.word) ?? resolveWord(dict, it.lemma)
    const mw = mwld?.(it.word) ?? mwld?.(it.lemma) ?? null
    // 连字符复合词（self-described / taxpayer-funded）词典一条都查不到，
    // 但词性能按末段后缀判出来：有词性才能参与语法标记和复习题型。
    const compoundPos = hit || mw ? null : guessCompoundPos(it.word)
    if (!hit && !mw && !compoundPos) return it
    const patch: Partial<VocabItem> = {}
    const fieldSources: VocabFieldSources = { ...it.fieldSources }
    // 词典只填空：不覆盖已有值；只有「用户手动清空过」的字段才主动跳过
    const ph = mw?.phonetic || hit?.entry.phonetic
    if (it.fieldSources?.phonetic !== 'manual' && !it.phonetic && ph) {
      patch.phonetic = `/${ph.replace(/^\/+|\/+$/g, '')}/`
      fieldSources.phonetic = 'dict'
    }
    const pos = normalizePos(mw?.pos || hit?.entry.pos || '')
    // 词性只在「这条还没有释义」时补：词典给的词性是**词头最常用**的那个义项，
    // 而 AI 查词给的是**语境里**那个义项。两者不是一回事——`consort` 卡上出现
    // 「n. 交往；厮混」就是这么来的（释义是动词义、词性被词典补成名词）。
    // 宁可少一个词性，也不能让卡上自相矛盾。
    const meaningFromDict = !it.meaning && !!(hit?.entry.zh || mw?.en)
    if (it.fieldSources?.partOfSpeech !== 'manual' && !it.partOfSpeech && pos && meaningFromDict) {
      patch.partOfSpeech = pos
      fieldSources.partOfSpeech = 'dict'
    }
    // 复合词：按后缀判出来的词性，不记来源（它不是词典的结论，也不能冒充 AI 看过语境）
    if (!it.partOfSpeech && !patch.partOfSpeech && compoundPos) {
      patch.partOfSpeech = compoundPos
    }
    const meaning = hit?.entry.zh ? cleanGloss(glossForPos(hit.entry.zh, pos || hit.entry.pos)) : ''
    if (it.fieldSources?.meaning !== 'manual' && !it.meaning && meaning) {
      patch.meaning = meaning
      fieldSources.meaning = 'dict'
    }
    const definition = cleanGloss(mw?.en || glossForPos(hit?.entry.en || '', pos))
    if (it.fieldSources?.definition !== 'manual' && !it.definition && definition) {
      patch.definition = definition
      fieldSources.definition = 'dict'
    }
    if (!Object.keys(patch).length) return it
    filled++
    changed = true
    if (it.status === 'unqueried' && (patch.meaning || it.meaning)) patch.status = 'queried'
    patch.fieldSources = fieldSources
    // 词典自己补出来的词性/释义也可能对不上（zh 多行、行首标记不同），出门前对齐一次
    return reconcileSense({ ...it, ...patch, updatedAt: iso })
  })
  return { library: changed ? { ...library, items } : library, filled }
}
