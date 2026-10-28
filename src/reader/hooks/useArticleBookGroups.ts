import { useMemo } from 'react'
import { styleOf, type ArticleBook } from '../../core/matchArticle'

/** 按期次给内置文章分组。文件名写法区分两代（见 matchArticle.styleOf）。 */
const EDITION_LABEL: Record<ReturnType<typeof styleOf>, string> = {
  spaced: '2016-09-10',
  dashed: '2021-06-12',
  other: '其它',
}
function editionOf(key: string): string {
  return EDITION_LABEL[styleOf(key)]
}

/** 内置原文列表：全部键 / 期次计数 / 当前筛选后的键。 */
export function useArticleBookGroups(book: ArticleBook | null, edition: string) {
  const bookKeys = useMemo(() => (book ? Object.keys(book).sort() : []), [book])
  const editions = useMemo(() => {
    const m = new Map<string, number>()
    for (const k of bookKeys) {
      const e = editionOf(k)
      m.set(e, (m.get(e) ?? 0) + 1)
    }
    return [...m.entries()]
  }, [bookKeys])
  const shownKeys = useMemo(
    () => bookKeys.filter((k) => edition === '全部' || editionOf(k) === edition),
    [bookKeys, edition],
  )
  return { bookKeys, editions, shownKeys }
}
