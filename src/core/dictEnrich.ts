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
import { resolveWord } from './ecdict'
import { cleanGloss, normalizePos } from './vocab'

/** 英英释义（M-W 学习词典）查询：给词形返回一条；没有就 null。 */
export type MwldLookup = (word: string) => { phonetic?: string; pos?: string; en?: string } | null

const firstLine = (s: string | undefined) => (s ?? '').split(/\\n|\n/).map((x) => x.trim()).filter(Boolean)[0] ?? ''

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
    if (!hit && !mw) return it
    const patch: Partial<VocabItem> = {}
    const fieldSources: VocabFieldSources = { ...it.fieldSources }
    // 词典只填空：不覆盖已有值；只有「用户手动清空过」的字段才主动跳过
    const ph = mw?.phonetic || hit?.entry.phonetic
    if (it.fieldSources?.phonetic !== 'manual' && !it.phonetic && ph) {
      patch.phonetic = `/${ph.replace(/^\/+|\/+$/g, '')}/`
      fieldSources.phonetic = 'dict'
    }
    const pos = normalizePos(mw?.pos || hit?.entry.pos || '')
    if (it.fieldSources?.partOfSpeech !== 'manual' && !it.partOfSpeech && pos) {
      patch.partOfSpeech = pos
      fieldSources.partOfSpeech = 'dict'
    }
    const meaning = hit?.entry.zh ? cleanGloss(firstLine(hit.entry.zh)) : ''
    if (it.fieldSources?.meaning !== 'manual' && !it.meaning && meaning) {
      patch.meaning = meaning
      fieldSources.meaning = 'dict'
    }
    const definition = cleanGloss(mw?.en || firstLine(hit?.entry.en || ''))
    if (it.fieldSources?.definition !== 'manual' && !it.definition && definition) {
      patch.definition = definition
      fieldSources.definition = 'dict'
    }
    if (!Object.keys(patch).length) return it
    filled++
    changed = true
    if (it.status === 'unqueried' && (patch.meaning || it.meaning)) patch.status = 'queried'
    patch.fieldSources = fieldSources
    return { ...it, ...patch, updatedAt: iso }
  })
  return { library: changed ? { ...library, items } : library, filled }
}
