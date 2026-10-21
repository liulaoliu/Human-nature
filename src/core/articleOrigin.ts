import type { ArticleOrigin } from '../types/document'

/**
 * 已保存文章来源的唯一合法值。
 *
 * 只在写入边界标：原文库 / 粘贴 / EPUB / txt·md·PDF 文件。
 * 旧数据没有 `origin` 就保持未知，不拿 `sourceKey` 或时间反推。
 */
export const ARTICLE_ORIGINS = ['library', 'paste', 'epub', 'file'] as const

const ORIGIN_SET = new Set<string>(ARTICLE_ORIGINS)

export function isArticleOrigin(value: unknown): value is ArticleOrigin {
  return typeof value === 'string' && ORIGIN_SET.has(value)
}

export const ARTICLE_ORIGIN_LABEL: Record<ArticleOrigin, string> = {
  library: '原文库',
  paste: '粘贴',
  epub: 'EPUB',
  file: '文件',
}

export function articleOriginLabel(value: unknown): string | null {
  return isArticleOrigin(value) ? ARTICLE_ORIGIN_LABEL[value] : null
}
