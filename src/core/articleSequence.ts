import type { SavedArticle } from './ports'

/** 选择器里的一篇文章：`ref` 直接喂给 `onPick`（`b:<key>` / `s:<id>`）。 */
export interface ArticleStep {
  ref: string
  title: string
}

/**
 * 文章阅读顺序：内置在前（按 key），已保存按分组顺序接在后面。
 *
 * 「上一篇 / 下一篇」和文章选择器共用这一条序列——不要各自算一遍，
 * 否则下拉里的顺序和翻页的顺序会悄悄不一样。
 */
export function articleSequence(
  builtinKeys: readonly string[],
  savedGroups: readonly (readonly [string, readonly SavedArticle[]])[],
): ArticleStep[] {
  return [
    ...[...builtinKeys].sort().map((key) => ({ ref: `b:${key}`, title: key })),
    ...savedGroups.flatMap(([, list]) => list.map((a) => ({ ref: `s:${a.id}`, title: a.title }))),
  ]
}

/** 当前文章在序列里的前后一篇；不在序列里（未保存的粘贴稿等）两边都是 null。 */
export function articleNeighbors(
  sequence: readonly ArticleStep[],
  currentRef: string,
): { prev: ArticleStep | null; next: ArticleStep | null; index: number } {
  const index = sequence.findIndex((x) => x.ref === currentRef)
  if (index < 0) return { prev: null, next: null, index: -1 }
  return {
    prev: sequence[index - 1] ?? null,
    next: sequence[index + 1] ?? null,
    index,
  }
}
