import { useCallback, useRef, useState } from 'react'
import type { MutableRefObject } from 'react'
import { dictConfusables, dictLemmaPairs, pickAboveLevelWords, type EcdictLevel } from '../../core/ecdict'
import { applyConfusables, applyLemmaMap, dedupeLibrary, lemmaOf } from '../../core/vocab'
import { enrichWithDict } from '../../core/dictEnrich'
import { isWordEntry } from '../../core/entryKind'
import type { VocabLibrary } from '../../types/document'
import { dictionary, mwldLookupWord } from '../../adapters/dictionary'

type BatchItemLike = { word: string; sentence: string; sentenceId: string | null }

export interface UseDictToolsParams {
  library: VocabLibrary
  /** 最新词库（一键连跑时每步都要读上一次 persist 的结果，不能拿渲染时的旧快照）。 */
  libraryRef?: MutableRefObject<VocabLibrary>
  persist: (library: VocabLibrary) => void
  doc: { sentences: { id: string; text: string }[] } | null
  level: EcdictLevel
  mergeBatch: (items: BatchItemLike[]) => void
  batchItemsFromWords: (words: string[]) => BatchItemLike[]
  flash: (message: string) => void
  /** 一键流程里的「补离线例句」（异步，由正文动作提供）。 */
  enrichExamples?: () => Promise<void> | void
  /** 一键流程每步之间的间隔；测试可设 0。 */
  stepDelayMs?: number
}

/**
 * 离线词典工具（不经过 AI）：用 ECDICT 给生词本补音标/词性/中英释义、校正原形、按级别挑词。
 * 词典未加载时全部 no-op（并提示）。
 */
export function useDictTools({
  library,
  libraryRef,
  persist,
  doc,
  level,
  mergeBatch,
  batchItemsFromWords,
  flash,
  enrichExamples,
  stepDelayMs = 120,
}: UseDictToolsParams) {
  const [busy, setBusy] = useState(false)
  const busyRef = useRef(false)
  const readLibrary = useCallback(() => libraryRef?.current ?? library, [library, libraryRef])

  /** 手动按钮：全库补一遍 + 提示补了多少 */
  const enrichFromDict = useCallback(() => {
    if (!dictionary()) {
      flash('词典未加载（先跑 npm run ecdict:build）')
      return
    }
    const { library: next, filled } = enrichWithDict(readLibrary(), dictionary()!, (w) => mwldLookupWord(w), new Date())
    if (!filled) {
      flash('没有可补齐的（词典里没有，或已有数据）')
      return
    }
    persist(next)
    flash(`已用词典补齐 ${filled} 个词`)
  }, [readLibrary, persist, flash])

  /** 用词典校正原形（word/lemma → 原型）并去重。 */
  const fixLemmasFromDict = useCallback(() => {
    const dict = dictionary()
    if (!dict) {
      flash('词典未加载（先跑 npm run ecdict:build）')
      return
    }
    const cur = readLibrary()
    const pairs = dictLemmaPairs(dict, cur.items)
    if (!pairs.length) {
      flash('没有可校正的原形（词典里查不到或已是原型）')
      return
    }
    persist(dedupeLibrary(applyLemmaMap(cur, pairs)))
    flash(`已校正 ${pairs.length} 个词形`)
  }, [readLibrary, persist, flash])

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
    // 这里是「看这一篇到底有多少超纲词」的诊断入口，不再一刀切截到 40：
    // 否则长文章永远提示「挑出 40 个」，用户看不出真实难度。批量加词仍由待选列表管理。
    const words = pickAboveLevelWords(dict, doc.sentences.map((s) => s.text).join(' '), level, Number.POSITIVE_INFINITY)
    if (!words.length) {
      flash('词典没挑出超纲词')
      return
    }
    const existing = new Set(readLibrary().items.map((it) => it.lemma))
    const fresh = words.filter((w) => !existing.has(lemmaOf(w))).length
    mergeBatch(batchItemsFromWords(words))
    flash(
      fresh
        ? `已按词典挑出 ${words.length} 个超纲词，其中「新 ${fresh}」个进「待选」${
            words.length - fresh ? `（另 ${words.length - fresh} 个已在生词本）` : ''
          }`
        : `挑出的 ${words.length} 个词都已在生词本里了 —— 去「生词本 / 全部生词」看`,
    )
  }, [doc, level, mergeBatch, batchItemsFromWords, flash, readLibrary])

  /** 用词典给缺混淆项的词本地生成干扰项（形近、义不同）。 */
  const confuseFromDict = useCallback(() => {
    const dict = dictionary()
    if (!dict) {
      flash('词典未加载（先跑 npm run ecdict:build）')
      return
    }
    const cur = readLibrary()
    const results: { word: string; confusables: { word: string; meaning?: string }[] }[] = []
    for (const it of cur.items) {
      if (!isWordEntry(it) || it.confusables?.length || !it.meaning) continue
      const conf = dictConfusables(dict, it.word)
      if (conf.length >= 3) results.push({ word: it.word, confusables: conf })
    }
    if (!results.length) {
      flash('词典没生成出混淆项（这些词没有合适的拼写近邻）')
      return
    }
    persist(applyConfusables(cur, results))
    flash(`已用词典给 ${results.length} 个词生成混淆项`)
  }, [readLibrary, persist, flash])

  /**
   * 一键依次跑：挑词 → 补齐 → 补例句 → 校正原形 → 补混淆项。
   *
   * 每步读 `libraryRef.current`，所以上一步 persist 的结果一定被下一步看到；
   * 间隔只是让 React 把按钮/提示刷出来，不靠「等状态更新」来保证正确性。
   * 例句放在校正之前：否则词形已改成原形，旧 articleWords 里的词形会对不上。
   */
  const runAll = useCallback(async () => {
    if (busyRef.current) return
    if (!dictionary()) {
      flash('词典未加载（先跑 npm run ecdict:build）')
      return
    }
    busyRef.current = true
    setBusy(true)
    const wait = () => new Promise<void>((resolve) => window.setTimeout(resolve, stepDelayMs))
    try {
      pickFromDict()
      await wait()
      enrichFromDict()
      await wait()
      if (enrichExamples) {
        try {
          await enrichExamples()
        } catch (e) {
          console.warn('[词典] 一键补例句失败', e)
          flash('补离线例句失败；其余步骤继续')
        }
        await wait()
      }
      fixLemmasFromDict()
      await wait()
      confuseFromDict()
      flash('一键处理完成（挑词 / 补齐 / 补例句 / 校正 / 混淆）')
    } finally {
      busyRef.current = false
      setBusy(false)
    }
  }, [pickFromDict, enrichFromDict, enrichExamples, fixLemmasFromDict, confuseFromDict, flash, stepDelayMs])

  return { enrichFromDict, fixLemmasFromDict, pickFromDict, confuseFromDict, runAll, busy }
}
