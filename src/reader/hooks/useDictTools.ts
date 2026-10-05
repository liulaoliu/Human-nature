import { useCallback } from 'react'
import { dictLemmaOf, firstLine, pickAboveLevelWords, resolveWord, type EcdictLevel } from '../../core/ecdict'
import { applyLemmaMap, dedupeLibrary, normalizeWord } from '../../core/vocab'
import type { VocabItem, VocabLibrary } from '../../types/document'
import { dictionary } from '../dictionary'

type BatchItemLike = { word: string; sentence: string; sentenceId: string | null }

export interface UseDictToolsParams {
  library: VocabLibrary
  persist: (library: VocabLibrary) => void
  doc: { sentences: { id: string; text: string }[] } | null
  level: EcdictLevel
  mergeBatch: (items: BatchItemLike[]) => void
  batchItemsFromWords: (words: string[]) => BatchItemLike[]
  flash: (message: string) => void
}

/**
 * 离线词典工具（不经过 AI）：用 ECDICT 给生词本补音标/词性/中英释义、校正原形、按级别挑词。
 * 词典未加载时全部 no-op（并提示）。
 */
export function useDictTools({ library, persist, doc, level, mergeBatch, batchItemsFromWords, flash }: UseDictToolsParams) {
  /** 用词典给生词本补齐缺失字段（音标/词性/中文释义/英英释义）。 */
  const enrichFromDict = useCallback(() => {
    const dict = dictionary()
    if (!dict) {
      flash('词典未加载（先跑 npm run ecdict:build）')
      return
    }
    let filled = 0
    const items = library.items.map((it) => {
      const hit = resolveWord(dict, it.word) ?? resolveWord(dict, it.lemma)
      if (!hit) return it
      const e = hit.entry
      const patch: Partial<VocabItem> = {}
      if (!it.phonetic && e.phonetic) patch.phonetic = `/${e.phonetic.replace(/^\/+|\/+$/g, '')}/`
      if (!it.partOfSpeech && e.pos) patch.partOfSpeech = e.pos
      if (!it.meaning && e.zh) patch.meaning = firstLine(e.zh)
      if (!it.definition && e.en) patch.definition = firstLine(e.en)
      if (!Object.keys(patch).length) return it
      filled++
      if (it.status === 'unqueried') patch.status = 'queried'
      return { ...it, ...patch, updatedAt: new Date().toISOString() }
    })
    if (!filled) {
      flash('没有可补齐的（词典里没有，或已有数据）')
      return
    }
    persist({ ...library, items })
    flash(`已用词典补齐 ${filled} 个词`)
  }, [library, persist, flash])

  /** 用词典校正原形（word/lemma → 原型）并去重。 */
  const fixLemmasFromDict = useCallback(() => {
    const dict = dictionary()
    if (!dict) {
      flash('词典未加载（先跑 npm run ecdict:build）')
      return
    }
    const pairs = library.items
      .map((it) => ({ from: it.word, to: dictLemmaOf(dict, it.word) }))
      .filter((p): p is { from: string; to: string } => !!p.to && normalizeWord(p.from) !== p.to)
    if (!pairs.length) {
      flash('没有可校正的原形（词典里查不到或已是原型）')
      return
    }
    persist(dedupeLibrary(applyLemmaMap(library, pairs)))
    flash(`已校正 ${pairs.length} 个词形`)
  }, [library, persist, flash])

  /** 用词典按当前词汇水平从本篇正文挑超纲词 → 待选（纯本地，不用 AI）。 */
  const pickFromDict = useCallback(() => {
    const dict = dictionary()
    if (!dict) {
      flash('词典未加载（先跑 npm run ecdict:build）')
      return
    }
    if (!doc || !doc.sentences.length) {
      flash('先打开一篇文章')
      return
    }
    const words = pickAboveLevelWords(dict, doc.sentences.map((s) => s.text).join(' '), level, 40)
    if (!words.length) {
      flash('词典没挑出超纲词')
      return
    }
    mergeBatch(batchItemsFromWords(words))
    flash(`已按词典挑出 ${words.length} 个超纲词进「待选」`)
  }, [doc, level, mergeBatch, batchItemsFromWords, flash])

  return { enrichFromDict, fixLemmasFromDict, pickFromDict }
}
