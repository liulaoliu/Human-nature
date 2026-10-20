/**
 * 阅读页滚动进度（按文章存）——**内存优先，localStorage 兜底**。
 *
 * 为什么内存在前：同一会话里「读一半 → 去侧栏做题 → 回来」这种切换很频繁，
 * 每次都读 localStorage 没必要；而页面整个重开（内存是空的）时才回落到硬存。
 * 所以这里维护一份 `Map<docKey, 比例>`，读写都先过它一眼。
 *
 * 规则（0–1 夹取、脏值回落）在 `core/scrollProgress`，这里只做键名与读写。
 */
import { parseScrollRatio, clampScrollRatio } from '../core/scrollProgress'

const keyOf = (docKey: string) => `reader:scroll:${docKey}`

/** 本次会话的进度缓存：docKey → 比例。页面重开就没了（这正是「内存优先」的边界）。 */
const memory = new Map<string, number>()

function readRaw(key: string): string | null {
  try {
    return globalThis.localStorage?.getItem(key) ?? null
  } catch {
    return null
  }
}

function writeRaw(key: string, value: string): void {
  try {
    globalThis.localStorage?.setItem(key, value)
  } catch {
    // 隐私模式 / 存储满了：这次不记，下次重新打开就从顶部开始
  }
}

/** 这篇上次读到哪（比例）；内存命中就直接给，没有再读本机；都没存过 = 顶部。 */
export function readScroll(docKey: string): number {
  if (!docKey) return 0
  const cached = memory.get(docKey)
  if (cached !== undefined) return cached
  const ratio = parseScrollRatio(readRaw(keyOf(docKey)))
  memory.set(docKey, ratio)
  return ratio
}

/** 记下这篇读到哪：内存与硬存一起写（调用方负责节流，别每个 scroll 事件都写）。 */
export function saveScroll(docKey: string, ratio: number): void {
  if (!docKey) return
  const value = clampScrollRatio(ratio)
  memory.set(docKey, value)
  writeRaw(keyOf(docKey), String(value))
}

/** 忘掉这篇的进度（内存 + 本机），例如正文被整篇替换后。 */
export function forgetScroll(docKey: string): void {
  if (!docKey) return
  memory.delete(docKey)
  try {
    globalThis.localStorage?.removeItem(keyOf(docKey))
  } catch {
    // 同上：删不掉也不影响阅读
  }
}

/** 清空会话缓存（测试用；不动本机存的值）。 */
export function clearScrollMemory(): void {
  memory.clear()
}
