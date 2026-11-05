import { useLayoutEffect, type RefObject } from 'react'

/**
 * 浮层面板的滚动位置记忆（只存内存）。
 *
 * 为什么不用 `useReadingScroll`：那套是正文的**阅读进度**，按比例存 localStorage；
 * 这里要的是「关掉精读面板去考试，回来还停在原来的位置」——纯 UI 现场，刷新后
 * 没必要恢复，也不该为了一个面板往 localStorage 里加键。
 *
 * 只记 `scrollTop` 像素、不记比例：面板内容在一次会话里不会变，按像素更准确。
 * 卸载时保存，挂载时恢复；不挂 scroll 监听，避免滚动时反复写。
 */
const MAX_KEYS = 20
const saved = new Map<string, number>()

/** 测试用：清掉模块级内存，避免用例之间串。 */
export function clearPanelScrollMemory(): void {
  saved.clear()
}

/** 测试 / 调试用：读出某个键记的滚动位置（没有就是 undefined）。 */
export function readPanelScrollMemory(key: string): number | undefined {
  return saved.get(key)
}

/**
 * 记一个键的滚动位置。重复键会挪到 Map 末尾（最近使用），
 * 超过 `MAX_KEYS` 淘汰最久没用的一个，避免同一会话里开过的文章无限堆积。
 */
function remember(key: string, top: number): void {
  if (!key || !Number.isFinite(top) || top <= 0) {
    saved.delete(key)
    return
  }
  saved.delete(key)
  saved.set(key, top)
  while (saved.size > MAX_KEYS) {
    const oldest = saved.keys().next().value
    if (oldest === undefined) break
    saved.delete(oldest)
  }
}

/**
 * 把 `ref` 指向的滚动容器接上「卸载保存 / 挂载恢复」。
 *
 * `key` 用文章标识：同一篇离开再回来恢复；换了文章就各记各的。
 * key 为空（没有文章的精读页）时不记。
 */
export function usePanelScrollMemory(ref: RefObject<HTMLElement | null>, key: string): void {
  useLayoutEffect(() => {
    const el = ref.current
    if (!el || !key) return
    const top = saved.get(key)
    if (top !== undefined) el.scrollTop = top
    return () => remember(key, el.scrollTop)
  }, [ref, key])
}
