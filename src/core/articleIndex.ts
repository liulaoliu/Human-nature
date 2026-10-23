import { shortHash, slugify } from './articleSlug'
import type { ArticleBook } from './matchArticle'
import type { SavedArticle } from './ports'

/**
 * 文章标识 ↔ URL slug 的双向索引。
 *
 * 标识（ref）是内部用的：
 *   `b:<articles.json 的键>`   内置文章
 *   `s:<SavedArticle.id>`      已保存 / 手动粘贴
 *
 * slug 是地址栏里用的可读片段（见 `core/articleSlug`）。
 * 两者不是编码关系 —— slug 由标题算出来，所以必须建表才能反查。
 */
export interface ArticleIndex {
  /** 标识 → slug；没这篇文章返回空串 */
  slugOf: (ref: string) => string
  /** slug → 标识；认不出来返回空串（说明链接指向的文章已经不在库里） */
  refOf: (slug: string) => string
}

/** 空索引：文章目录和已保存列表都还没加载完时用它，任何查询都返回空串。 */
export const EMPTY_ARTICLE_INDEX: ArticleIndex = { slugOf: () => '', refOf: () => '' }

/**
 * 建索引。同一组数据永远得到同一套 slug（顺序只影响冲突时谁拿裸 slug，
 * 而这里已经按 key/id 排序，所以是确定的）。
 *
 * 规则：
 *   · 标题能算出 slug 就用它；
 *   · 算不出来（纯中文 / 纯符号）→ `article-<hash>`;
 *   · 算出来但和别人撞了 → 双方都加 `<hash>` 后缀（不是"先到先得"，
 *     否则删掉一篇文章会让另一篇的 URL 悄悄变掉）。
 */
export function buildArticleIndex(
  book: ArticleBook | null,
  saved: ReadonlyArray<SavedArticle>,
): ArticleIndex {
  const entries: Array<{ ref: string; title: string }> = []
  for (const key of Object.keys(book ?? {}).sort()) {
    entries.push({ ref: `b:${key}`, title: book?.[key]?.title || key })
  }
  for (const a of [...saved].sort((x, y) => x.id.localeCompare(y.id))) {
    entries.push({ ref: `s:${a.id}`, title: a.title })
  }
  if (!entries.length) return EMPTY_ARTICLE_INDEX

  const bases = entries.map((e) => slugify(e.title))
  const seen = new Map<string, number>()
  for (const b of bases) seen.set(b, (seen.get(b) ?? 0) + 1)

  const byRef = new Map<string, string>()
  const bySlug = new Map<string, string>()
  entries.forEach((e, i) => {
    const base = bases[i]
    const dup = base ? (seen.get(base) ?? 0) > 1 : true
    const slug = dup ? `${base || 'article'}-${shortHash(e.ref)}` : base
    byRef.set(e.ref, slug)
    bySlug.set(slug, e.ref)
  })

  return {
    slugOf: (ref) => byRef.get(ref) ?? '',
    refOf: (slug) => bySlug.get(slug) ?? '',
  }
}
