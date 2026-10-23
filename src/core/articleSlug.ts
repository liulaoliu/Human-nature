/**
 * 文章标识 ↔ URL 路径段的互相转换。
 *
 * 为什么需要：内部标识长这样 —— `b:005 Leaders - Post-truth politics`、
 * `s:saved:005 Leaders@a1b2c3`。直接塞进地址栏会变成
 * `b%3A005%20Leaders%20-%20Post-truth%20politics`，一堆 `%3A` / `%20`，
 * 既不像"正规路由"，也没法手工敲。
 *
 * 所以 URL 用 slug（`005-leaders-post-truth-politics`），内部标识留在内存里。
 * slug 不是标识的编码，只是一个**稳定别名**：同一篇文章永远算出同一个 slug，
 * 而且能反查回标识（靠 `buildArticleIndex` 建的表）。
 */

/**
 * 标题 → URL 片段：小写、去重音、非字母数字一律变连字符。
 *
 * 只保留 `[a-z0-9-]`，所以 URL 里永远不会出现需要百分号转义的字符。
 * 中文标题会被整段剥掉（返回空串），由调用方退回 `article-<hash>` ——
 * 与其在地址栏里放 `%E4%B8%AD%E6%96%87`，不如给个短的稳定别名。
 */
export function slugify(text: string): string {
  return text
    .normalize('NFKD')
    // 去掉组合用变音符号（é → e）
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 72)
    .replace(/-+$/g, '')
}

/**
 * 稳定短哈希（FNV-1a，4 位 base36）。
 *
 * 只用来**消歧**：两篇文章 slug 撞了（比如同名标题、或都是中文标题被剥成空串），
 * 追加它把两者分开。同一输入永远同一结果，所以刷新/收藏都不会变。
 */
export function shortHash(text: string): string {
  let h = 2166136261
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return (h >>> 0)
    .toString(36)
    .slice(-4)
    .padStart(4, '0')
}
