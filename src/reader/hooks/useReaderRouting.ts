import { useMemo } from 'react'
import { useLocation } from 'react-router-dom'
import { buildArticleIndex } from '../../core/articleIndex'
import type { ArticleBook } from '../../core/matchArticle'
import type { SavedArticle } from '../../core/ports'
import { parseReaderRoute, useRoutedPanels } from '../route'
import { useReaderPanels } from './useReaderPanels'
import { useArticleRoute, type UseArticleRouteParams } from './useArticleRoute'

/**
 * 路由/面板接线的两段（组合根只拿结果，不再自己拼）。
 *
 * 拆成两段是因为它们需要的输入出现的时机不同：
 *   - 面板开关在很靠前的位置就要用（会话服务、快捷键都读 `speedReadOpen` 等），
 *     只需要当前 slug；
 *   - 文章路由要等文章索引、正文和工作区都就绪，且要把 `onPick` 换成「只导航」版本。
 */
/**
 * 当前文章的内部标识 / URL slug / 索引表。
 *
 * 这三样要在一起算：URL 里放 slug，slug 由标题生成，而文章加载又靠内部标识。
 * 组合根只拿结果，不自己拼 `b:` / `s:` 前缀。
 */
export function useReaderArticleIdentity(
  book: ArticleBook | null,
  saved: SavedArticle[],
  articleKey: string | null,
  savedId: string | null,
) {
  const articleIndex = useMemo(() => buildArticleIndex(book, saved), [book, saved])
  /** 当前文章在路由里的内部标识：'b:<内置 key>' / 's:<已保存 id>' / 空串（没打开文章）。 */
  const currentRef = savedId ? `s:${savedId}` : articleKey ? `b:${articleKey}` : ''
  /** 当前文章在 URL 里的样子（空串 = 索引里还没有它，先别动地址栏）。 */
  const currentSlug = currentRef ? articleIndex.slugOf(currentRef) : ''
  return { articleIndex, currentRef, currentSlug }
}

export function useReaderPanelRouting(currentSlug: string) {
  const { pathname, search } = useLocation()
  const route = useMemo(() => parseReaderRoute(pathname, search), [pathname, search])
  const raw = useReaderPanels()
  const panels = useRoutedPanels(raw, route, currentSlug)
  return { route, panels }
}

export function useReaderArticleRouting(params: UseArticleRouteParams) {
  const routePick = useArticleRoute(params)
  const { routeSlug, indexReady, refOf, currentRef } = params
  /**
   * 正文槽位的路由事实：URL 指向哪篇、索引是否就绪、当前打开的是哪篇。
   * 具体显示 composer / loading / missing / article 由 `screen/bodyMode.ts` 判定。
   */
  const articleRouting = useMemo(
    () => ({
      slug: routeSlug,
      indexReady,
      ref: routeSlug ? refOf(routeSlug) : '',
      currentRef,
    }),
    [routeSlug, indexReady, refOf, currentRef],
  )
  return { routePick, articleRouting }
}
