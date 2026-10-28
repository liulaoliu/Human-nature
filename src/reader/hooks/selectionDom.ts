/** 正文选区用到的 DOM 小工具；只回答“节点在哪”，不碰业务状态。 */

/** 顺着节点往上找它所在的句子 span（用 class="sent" 认）。 */
export function sentSpanOf(node: Node | null): HTMLElement | null {
  let el: Node | null = node instanceof Element ? node : node?.parentNode ?? null
  while (el && !(el instanceof HTMLElement && el.classList.contains('sent'))) el = el.parentNode
  return el instanceof HTMLElement ? el : null
}

/** container/offset 相对 root 起点、按字符算的偏移量。 */
export function offsetIn(root: HTMLElement, container: Node, offset: number): number | null {
  if (!root.contains(container)) return null
  const r = document.createRange()
  r.selectNodeContents(root)
  r.setEnd(container, offset)
  return r.toString().length
}

/** 同一个 sid 可能渲染多份（只看译文时英文隐藏）；优先拿真正可见的那个。 */
export function visibleSidNode(root: HTMLElement | null, sid: string): HTMLElement | null {
  if (!root) return null
  const nodes = root.querySelectorAll(`[data-sid="${CSS.escape(sid)}"]`)
  return ([...nodes] as HTMLElement[]).find((e) => e.offsetParent !== null) ?? null
}
