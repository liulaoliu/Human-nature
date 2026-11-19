import type { SavedArticle } from './ports'

/** 「没归到某本书」的兜底分组名（同时也是选择器里的固定分组）。 */
export const SINGLE_ARTICLE_GROUP = '单篇'

/**
 * 已保存文章的分组与排序——**目录要保持稳定**。
 *
 * 规则：
 *   · 组按书名字母序，「单篇」固定排最后；
 *   · 组内按建立时间从旧到新（EPUB 章节顺序就是导入顺序），没有 createdAt 的退回 updatedAt；
 *   · 时间相同再按标题 / id，保证同一份数据每次得到同一个顺序。
 *
 * 为什么不用 updatedAt 倒序：读一篇 / 改一个词就会把它顶到最前，目录位置漂移，
 * 上一篇 / 下一篇也会跟着换对象。最近打开放在选择器顶部的独立分组里，不动目录。
 */
export function groupSavedArticles(saved: readonly SavedArticle[]): [string, SavedArticle[]][] {
  const map = new Map<string, SavedArticle[]>()
  for (const a of saved) {
    const book = a.book || SINGLE_ARTICLE_GROUP
    const list = map.get(book)
    if (list) list.push(a)
    else map.set(book, [a])
  }
  const groups = [...map.entries()]
  for (const [, list] of groups) list.sort(compareSavedArticles)
  groups.sort(([a], [b]) => {
    if (a === b) return 0
    if (a === SINGLE_ARTICLE_GROUP) return 1
    if (b === SINGLE_ARTICLE_GROUP) return -1
    return a.localeCompare(b)
  })
  return groups
}

/** 目录里的先后：建立时间 → 标题 → id（后两项只是稳定兜底）。 */
export function compareSavedArticles(a: SavedArticle, b: SavedArticle): number {
  const at = a.createdAt ?? a.updatedAt ?? ''
  const bt = b.createdAt ?? b.updatedAt ?? ''
  return at.localeCompare(bt) || a.title.localeCompare(b.title) || a.id.localeCompare(b.id)
}
