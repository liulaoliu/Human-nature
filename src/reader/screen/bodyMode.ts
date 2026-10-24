/** 正文槽位当前该显示什么。 */
export type BodyMode = 'composer' | 'loading' | 'missing' | 'article'

export interface BodyModeInput {
  /** 用户主动点了「新建 / 粘贴」 */
  composing: boolean
  /** URL 里的文章 slug（空串 = 没打开文章） */
  routeSlug: string
  /** 文章索引是否就绪（已保存列表 + 内置目录都加载完，或目录已确认失败） */
  indexReady: boolean
  /** URL 的 slug 解析出的内部标识；空串 = 索引里没有这篇 */
  routeRef: string
  /** 当前已经打开的那篇内部标识 */
  currentRef: string
  hasDoc: boolean
}

/**
 * 正文槽位的判定（纯函数，UI 只按结果渲染）。
 *
 * 旧代码用 `composing || !doc`：深链接 `/reader/a/<slug>` 首帧、索引/正文还没到时
 * `!doc` 也为真，于是先闪一下「新建文章」的 Composer，再切成正文。
 * 现在只有**用户主动新建**才进 Composer；URL 指向文章时，
 * 索引没就绪 / 正文还没加载 = loading，索引里查无此篇 = missing。
 */
export function bodyMode({
  composing,
  routeSlug,
  indexReady,
  routeRef,
  currentRef,
  hasDoc,
}: BodyModeInput): BodyMode {
  if (composing) return 'composer'
  if (!routeSlug) return hasDoc ? 'article' : 'composer'
  if (!indexReady) return 'loading'
  if (!routeRef) return 'missing'
  if (routeRef !== currentRef || !hasDoc) return 'loading'
  return 'article'
}
