import { useMemo } from 'react'
import type { ArticleIndex } from '../../core/articleIndex'
import type { ReaderRoute } from '../route'
import { useReaderArticleRouting } from './useReaderRouting'
import type { useArticleWorkspace } from './useArticleWorkspace'

interface ReaderArticleNavigationArgs {
  route: ReaderRoute
  currentRef: string
  articleIndex: ArticleIndex
  articleIndexReady: boolean
  hasDoc: boolean
  workspace: ReturnType<typeof useArticleWorkspace>
  setDoc: (doc: null) => void
  setArticleKey: (key: string | null) => void
  setSavedId: (id: string | null) => void
}

/**
 * URL ↔ 当前文章的最后一段接线：
 * 路由回调、文章事实、以及「只导航」版的 workspace。
 *
 * 这段需要等 workspace 就绪，所以不能和前面的面板路由合成一个 hook；
 * 但也不该继续散在 ReaderApp 里。
 */
export function useReaderArticleNavigation({
  route,
  currentRef,
  articleIndex,
  articleIndexReady,
  hasDoc,
  workspace,
  setDoc,
  setArticleKey,
  setSavedId,
}: ReaderArticleNavigationArgs) {
  const { routePick, articleRouting } = useReaderArticleRouting({
    routeSlug: route.slug,
    routePanel: route.panel,
    routeOverlay: route.overlay,
    currentRef,
    slugOf: articleIndex.slugOf,
    refOf: articleIndex.refOf,
    indexReady: articleIndexReady,
    hasDoc,
    onPick: (ref) => workspace.docApi.onPick(ref),
    onClear: () => {
      setDoc(null)
      setArticleKey(null)
      setSavedId(null)
      try {
        localStorage.removeItem('reader:last')
      } catch {
        // 隐私模式忽略
      }
    },
  })

  /** 文章选择器改成「只导航」，真正加载由 useArticleRoute 的第 ② 条负责。 */
  const routedWorkspace = useMemo(
    () => ({ ...workspace, docApi: { ...workspace.docApi, onPick: routePick } }),
    [workspace, routePick],
  )

  return { routePick, articleRouting, routedWorkspace }
}
