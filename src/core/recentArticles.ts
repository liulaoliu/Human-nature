/** 最近打开最多记几篇（只影响「最近打开」分组，不动目录）。 */
export const RECENT_LIMIT = 5

/** `b:<内置 key>` / `s:<已保存 id>`；空 key / 空 id 不认。 */
const REF_PATTERN = /^[bs]:./

/** 解析本机存的最近打开列表：只认合法 ref、去重、截断。坏数据当空表。 */
export function parseRecentRefs(raw: unknown): string[] {
  if (!Array.isArray(raw)) return []
  const out: string[] = []
  for (const value of raw) {
    if (typeof value !== 'string' || !REF_PATTERN.test(value) || out.includes(value)) continue
    out.push(value)
    if (out.length >= RECENT_LIMIT) break
  }
  return out
}

/** 把刚打开的一篇放到最前；已经在列表里的先移除再插入，保证不重复。 */
export function pushRecentRef(list: readonly string[], ref: string, limit = RECENT_LIMIT): string[] {
  if (!REF_PATTERN.test(ref)) return [...list]
  return [ref, ...list.filter((x) => x !== ref)].slice(0, Math.max(1, limit))
}
