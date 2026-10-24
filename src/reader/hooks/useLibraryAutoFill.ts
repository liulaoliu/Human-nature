import { useCallback, useEffect, useMemo, useState, type MutableRefObject } from 'react'
import type { Sentence, VocabLibrary } from '../../types/document'
import { autoFillLibrary } from '../../core/libraryAutoFill'
import type { Ecdict } from '../../core/ecdict'
import { languagePointsOf } from '../../core/langPoints'
import { loadTatoeba, tatoebaExamples } from '../../adapters/tatoeba'
import { useLocalStorageState } from './useLocalStorageState'

/**
 * 词库「自动补全」的接线（**唯一写入口**）：语言点收藏 + 离线例句补全。
 *
 * 纯计划在 `core/libraryAutoFill.ts`（幂等、有单测）；这里只负责：
 *   - 收集素材（当前文章 + 已保存文章的语言点；离线例句查询函数）
 *   - 调计划、落库一次
 *
 * ⚠️ 两条硬约定（违反就会回到「两个 effect 互相覆盖、词库数量来回跳」的坑，见 docs/TESTING.md 踩坑 #1）：
 *   1. **依赖里不放 `library`**：要读当前词库就读 `libraryRef.current`；
 *   2. 新的「自动补全」加进 `autoFillLibrary`，**不要再写第二个 effect 去读写词库**。
 */
export interface UseLibraryAutoFillParams {
  /** 当前文档的句子（拿语言点用） */
  sentences: Pick<Sentence, 'id' | 'text' | 'language' | 'languages'>[] | null
  /** 已保存的文章（id + 句子） */
  saved: { id: string; sentences: Pick<Sentence, 'id' | 'text' | 'language' | 'languages'>[] }[]
  /** 当前文章的稳定标识 */
  articleIdentity: string | null
  /** 词库最新值（用 ref 读，避免把 library 变成依赖） */
  libraryRef: MutableRefObject<VocabLibrary>
  /** 词库是否已从 IndexedDB 读回来（读完才补，避免和加载抢写） */
  libraryLoaded: boolean
  /** 落库（ReaderApp 的 persist） */
  persist: (library: VocabLibrary) => void
  /** 离线词典（就绪后给，null = 未加载）；词形归并也在同一个 effect 里做 */
  dict?: Ecdict | null
}

export interface UseLibraryAutoFillResult {
  /** 离线例句查询（手动「补齐例句」按钮与自动补全共用） */
  lookupTatoeba: (it: { word: string; lemma: string }) => { text: string; translation?: string }[]
  /** 离线例句库是否就绪 */
  tatoebaReady: boolean
  /** 当前待收藏的语言点条数（给面板/调试看） */
  languagePointCount: number
}

export function useLibraryAutoFill({
  sentences,
  saved,
  articleIdentity,
  libraryRef,
  libraryLoaded,
  persist,
  dict,
}: UseLibraryAutoFillParams): UseLibraryAutoFillResult {
  /** 每篇文章收过的语言点签名（一篇只收一遍：删掉的条目不会自己回来） */
  const [langCollected, setLangCollected] = useLocalStorageState<Record<string, string>>('reader:langCollected', {})
  const [tatoebaReady, setTatoebaReady] = useState(false)

  /** 离线例句查询（Tatoeba）：手动按钮与自动补全共用同一份。 */
  const lookupTatoeba = useCallback(
    (it: { word: string; lemma: string }) =>
      tatoebaExamples(it.word, it.lemma).map((e) => ({ text: e.en, translation: e.zh })),
    [],
  )

  /** 离线例句库加载一次（没装就保持 false，功能降级不报错）。同样等空闲：6.6MB，别抢首屏。 */
  useEffect(() => {
    let alive = true
    if (typeof fetch !== 'function') return
    const start = () => {
      void loadTatoeba()
        .then((ok) => {
          if (alive) setTatoebaReady(ok)
        })
        .catch(() => {
          // 没装离线例句库：静默降级（功能还在，只是没有离线例句）
        })
    }
    const ric = (globalThis as { requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number })
      .requestIdleCallback
    const idleId = typeof ric === 'function' ? ric(start, { timeout: 4000 }) : window.setTimeout(start, 500)
    return () => {
      alive = false
      if (typeof ric === 'function') (globalThis as { cancelIdleCallback?: (id: number) => void }).cancelIdleCallback?.(idleId)
      // 用 window.clearTimeout：装了 @types/node 之后裸 `setTimeout` 的返回类型是
      // `number | NodeJS.Timeout`，和 DOM 的 `clearTimeout(number)` 对不上。
      // 这段本来就只跑在浏览器里，走 window 版本类型才准确。
      else window.clearTimeout(idleId)
    }
  }, [])

  /** 待收藏的语言点素材：已保存文章在前，当前这篇在后（同样的句子以当前原文为准） */
  const languagePoints = useMemo(() => {
    const others = saved.filter((a) => a.id !== articleIdentity)
    const out = others.flatMap((a) => languagePointsOf(a.sentences, { articleId: a.id, fileName: a.id }))
    if (articleIdentity && sentences) {
      out.push(...languagePointsOf(sentences, { articleId: articleIdentity, fileName: articleIdentity }))
    }
    return out
  }, [saved, sentences, articleIdentity])

  useEffect(() => {
    if (!libraryLoaded) return
    const out = autoFillLibrary(libraryRef.current, {
      langPoints: languagePoints,
      collected: langCollected,
      offline: tatoebaReady ? { lookup: lookupTatoeba } : undefined,
      dict,
    })
    if (!out.libraryUntouched) persist(out.library)
    if (!out.collectedUntouched) setLangCollected(out.collected)
  }, [libraryLoaded, languagePoints, langCollected, tatoebaReady, lookupTatoeba, persist, setLangCollected, libraryRef, dict])

  return { lookupTatoeba, tatoebaReady, languagePointCount: languagePoints.length }
}
