import { useCallback, useEffect, useMemo, useRef } from 'react'
import type { VocabLibrary } from '../../types/document'
import { wordsFromArticleMarks, type ArticleWithMarks } from '../../core/libraryFromArticles'
import { wordEntries } from '../../core/entryKind'
import { readJson, writeJson } from '../storage'

/**
 * 正文标记的接线：把「已保存文章 + 当前文章」的 `Sentence.vocab` 汇总起来，
 * 供「从正文标记重建词库」用（丢词事故里最准的一条路：那是当年真正标过的词）。
 *
 * 抽成 hook 的原因：这段只跟文章有关，不该塞进 ReaderApp（那里已经很大了），
 * 而且数量统计与重建用的是同一份数据，放一起才不会算错。
 */
export interface UseArticleMarksParams {
  /** 已保存文章（含句子与 Sentence.vocab） */
  saved: { id: string; sentences: { id: string; text: string; vocab?: string[] }[] }[]
  /** 当前文档的句子（可能有未保存的标记） */
  sentences: { id: string; text: string; vocab?: string[] }[] | null
  articleIdentity: string | null
  /** 真正落库的动作（由 useVocabLibrary 提供）；可选带一步本地补释义 */
  rebuild: (articles: ArticleWithMarks[], enrich?: (lib: VocabLibrary) => VocabLibrary) => void
  /** 本地补释义（离线词典；没就绪就是恒等函数） */
  enrich?: (lib: VocabLibrary) => VocabLibrary
  /** 当前词库（判断「是不是空了」，好自动救回） */
  library: VocabLibrary
  /** 只有读成功（ok）才允许自动写 */
  libraryLoad: 'pending' | 'ok' | 'failed'
  flash: (msg: string) => void
}

export interface UseArticleMarksResult {
  /** 正文标记里能认出多少个词（>0 就值得重建） */
  markedWordCount: number
  /** 一键重建（把汇总好的文章交给重建函数） */
  rebuildFromMarks: () => void
}

export function useArticleMarks({
  saved,
  sentences,
  articleIdentity,
  rebuild,
  enrich,
  library,
  libraryLoad,
  flash,
}: UseArticleMarksParams): UseArticleMarksResult {
  const articles = useMemo<ArticleWithMarks[]>(
    () => [
      ...saved.map((a) => ({ id: a.id, sentences: a.sentences })),
      ...(articleIdentity && sentences ? [{ id: articleIdentity, sentences }] : []),
    ],
    [saved, sentences, articleIdentity],
  )
  const markedWordCount = useMemo(() => wordsFromArticleMarks(articles).length, [articles])
  const rebuildFromMarks = useCallback(() => rebuild(articles, enrich), [rebuild, enrich, articles])

  /**
   * **自动救回**（不用你点）：词库一个单词都没有、但正文里还留着标记 → 自动重建一次。
   *
   * 三条安全边界：
   *   1. 只在 `libraryLoad === 'ok'`（读成功）时动手 —— 读失败一个字都不写（踩坑 #7）；
   *   2. 只在**词库确实没有普通单词**、且正文里**确实有标记**时才动手；
   *   3. 只做一次（`reader:marksAutoHealDone` 落盘）—— 你以后主动清空词库，不会被又塞回来。
   */
  const healed = useRef(false)
  useEffect(() => {
    if (healed.current || libraryLoad !== 'ok') return
    if (readJson<boolean>('reader:marksAutoHealDone', false)) return
    if (wordEntries(library.items).length > 0) return
    if (markedWordCount === 0) return
    healed.current = true
    writeJson('reader:marksAutoHealDone', true)
    flash(`词库是空的，但正文里还留着 ${markedWordCount} 个标记词 —— 正在自动找回…`)
    rebuildFromMarks()
  }, [libraryLoad, library.items, markedWordCount, rebuildFromMarks, flash])

  return { markedWordCount, rebuildFromMarks }
}
