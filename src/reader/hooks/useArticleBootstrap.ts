import { useEffect, useRef, useState } from 'react'
import type { ArticleBook } from '../../core/matchArticle'
import type { ArticleRepoPort, SavedArticle } from '../../core/ports'
import { createArticleRepo } from '../../adapters/articleRepo'

/**
 * 启动时加载：文章仓储（本地兜底 → 列表）+ 内置文章目录 `articles.json`。
 *
 * 两件事都失败不阻塞页面：已保存列表失败只 warn 并标记 loaded，内置目录失败交给
 * `bookError` 让界面提示「要 http://localhost 打开」。仓储实例通过 ref 暴露，
 * 供后续 `useReaderDoc` / 导入导出复用。
 */
export function useArticleBootstrap(onError?: (message: string) => void) {
  const [book, setBook] = useState<ArticleBook | null>(null)
  const [bookError, setBookError] = useState(false)
  const [saved, setSaved] = useState<SavedArticle[]>([])
  const [savedLoaded, setSavedLoaded] = useState(false)
  const articles = useRef<ArticleRepoPort | null>(null)

  useEffect(() => {
    const ar = createArticleRepo()
    articles.current = ar
    void (async () => {
      // 先把本地兜底补进 SQLite（失败不阻塞列表：list 会合并本地较新的版本）
      try {
        await ar.reconcile?.()
      } catch (e) {
        console.warn('[文章] 启动迁移失败', e)
      }
      try {
        setSaved(await ar.list())
      } catch (e) {
        console.warn('[文章] 已保存列表加载失败', e)
        onError?.('已保存文章读取失败：列表可能不完整；请先导出备份，再刷新重试')
      } finally {
        setSavedLoaded(true)
      }
    })()
    fetch(`${import.meta.env.BASE_URL}articles.json`)
      .then((x) => (x.ok ? x.json() : Promise.reject(new Error(String(x.status)))))
      .then((b: ArticleBook) => setBook(b))
      .catch((e) => {
        console.warn('[文章] 内置目录加载失败', e)
        setBookError(true)
      })
  }, [onError])

  return { book, bookError, saved, setSaved, savedLoaded, articles }
}
