/**
 * 「最近打开」的文章 ref（`b:<key>` / `s:<id>`）——只给选择器顶部的独立分组用。
 *
 * 目录位置由 `core/articleOrder` 固定，不按更新时间漂；只有这条最近记录会变。
 * 读写都吞异常（隐私模式 / 配额满），坏了就当没有最近记录，不影响打开文章。
 */
import { parseRecentRefs, RECENT_LIMIT } from '../core/recentArticles'

const KEY = 'reader:recentArticles'

/** 本次会话缓存：页面重开就回落到 localStorage。 */
let memory: string[] | null = null

function readRaw(): string | null {
  try {
    return globalThis.localStorage?.getItem(KEY) ?? null
  } catch {
    return null
  }
}

function parseRaw(raw: string | null): string[] {
  if (!raw) return []
  try {
    return parseRecentRefs(JSON.parse(raw))
  } catch {
    return []
  }
}

/** 最近打开（最近的在前）；同一会话内走内存，刷新后读本机。 */
export function readRecentArticles(): string[] {
  if (!memory) memory = parseRaw(readRaw())
  return [...memory]
}

/** 覆盖写入最近打开列表（调用方负责去重与顺序）。 */
export function saveRecentArticles(refs: readonly string[]): void {
  memory = refs.slice(0, RECENT_LIMIT)
  try {
    globalThis.localStorage?.setItem(KEY, JSON.stringify(memory))
  } catch {
    // 隐私模式 / 存储满了：这次不记，目录不受影响
  }
}

/** 清掉会话缓存（测试用；不清本机值）。 */
export function clearRecentArticlesMemory(): void {
  memory = null
}
