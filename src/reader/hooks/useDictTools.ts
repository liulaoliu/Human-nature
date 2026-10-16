import { useCallback } from 'react'
import { dictConfusables, dictLemmaPairs, pickAboveLevelWords, type EcdictLevel } from '../../core/ecdict'
import { applyConfusables, applyLemmaMap, dedupeLibrary, lemmaOf } from '../../core/vocab'
import { enrichWithDict } from '../../core/dictEnrich'
import { isWordEntry } from '../../core/entryKind'
import type { VocabLibrary } from '../../types/document'
import { dictionary, mwldLookupWord } from '../dictionary'

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
  /**
   * 用离线词典补音标/词性/中英释义（纯逻辑在 core/dictEnrich，本地、幂等）。
   * 返回「补过的词库」；词典没就绪就原样返回 —— 自动找回词条时可以直接接在重建后面。
   */
  const enrichLibrary = useCallback(
    (lib: VocabLibrary): VocabLibrary => {
      const dict = dictionary()
      if (!dict) return lib
      return enrichWithDict(lib, dict, (w) => mwldLookupWord(w), new Date()).library
    },
    [],
  )

  /** 手动按钮：全库补一遍 + 提示补了多少 */
  const enrichFromDict = useCallback(() => {
    if (!dictionary()) {
      flash('词典未加载（先跑 npm run ecdict:build）')
      return
    }
    const { library: next, filled } = enrichWithDict(library, dictionary()!, (w) => mwldLookupWord(w), new Date())
    if (!filled) {
      flash('没有可补齐的（词典里没有，或已有数据）')
      return
    }
    persist(next)
    flash(`已用词典补齐 ${filled} 个词`)
  }, [library, persist, flash])

  /** 用词典校正原形（word/lemma → 原型）并去重。 */
  const fixLemmasFromDict = useCallback(() => {
    const dict = dictionary()
    if (!dict) {
      flash('词典未加载（先跑 npm run ecdict:build）')
      return
    }
    const pairs = dictLemmaPairs(dict, library.items)
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
    const existing = new Set(library.items.map((it) => it.lemma))
    const fresh = words.filter((w) => !existing.has(lemmaOf(w))).length
    mergeBatch(batchItemsFromWords(words))
    flash(
      fresh
        ? `已按词典挑出 ${words.length} 个超纲词，其中「新 ${fresh}」个进「待选」${
            words.length - fresh ? `（另 ${words.length - fresh} 个已在生词本）` : ''
          }`
        : `挑出的 ${words.length} 个词都已在生词本里了 —— 去「生词本 / 全部生词」看`,
    )
  }, [doc, level, mergeBatch, batchItemsFromWords, flash, library])

  /** 用词典给缺混淆项的词本地生成干扰项（形近、义不同）。 */
  const confuseFromDict = useCallback(() => {
    const dict = dictionary()
    if (!dict) {
      flash('词典未加载（先跑 npm run ecdict:build）')
      return
    }
    const results: { word: string; confusables: { word: string; meaning?: string }[] }[] = []
    for (const it of library.items) {
      if (!isWordEntry(it) || it.confusables?.length || !it.meaning) continue
      const conf = dictConfusables(dict, it.word)
      if (conf.length >= 3) results.push({ word: it.word, confusables: conf })
    }
    if (!results.length) {
      flash('词典没生成出混淆项（这些词没有合适的拼写近邻）')
      return
    }
    persist(applyConfusables(library, results))
    flash(`已用词典给 ${results.length} 个词生成混淆项`)
  }, [library, persist, flash])

  return { enrichFromDict, enrichLibrary, fixLemmasFromDict, pickFromDict, confuseFromDict }
}
