import { useCallback, useMemo } from 'react'
import { wordsFromArticleMarks, type ArticleWithMarks } from '../../core/libraryFromArticles'

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
  /** 真正落库的动作（由 useVocabLibrary 提供） */
  rebuild: (articles: ArticleWithMarks[]) => void
}

export interface UseArticleMarksResult {
  /** 正文标记里能认出多少个词（>0 就值得重建） */
  markedWordCount: number
  /** 一键重建（把汇总好的文章交给重建函数） */
  rebuildFromMarks: () => void
}

export function useArticleMarks({ saved, sentences, articleIdentity, rebuild }: UseArticleMarksParams): UseArticleMarksResult {
  const articles = useMemo<ArticleWithMarks[]>(
    () => [
      ...saved.map((a) => ({ id: a.id, sentences: a.sentences })),
      ...(articleIdentity && sentences ? [{ id: articleIdentity, sentences }] : []),
    ],
    [saved, sentences, articleIdentity],
  )
  const markedWordCount = useMemo(() => wordsFromArticleMarks(articles).length, [articles])
  const rebuildFromMarks = useCallback(() => rebuild(articles), [rebuild, articles])
  return { markedWordCount, rebuildFromMarks }
}
