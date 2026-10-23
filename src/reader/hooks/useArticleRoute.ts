import { useCallback, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { articlePath } from '../route'

export interface UseArticleRouteParams {
  /** URL 里的文章 slug（空串 = 没打开文章） */
  routeSlug: string
  /** 当前已经打开的那篇的内部标识（`b:xxx` / `s:yyy`） */
  currentRef: string
  /** 标识 → slug（把当前文章写进 URL 用） */
  slugOf: (ref: string) => string
  /** slug → 标识（URL → 文章用） */
  refOf: (slug: string) => string
  /** 索引是否就绪：文章目录与已保存列表都加载完才敢按 URL 找文章 */
  indexReady: boolean
  hasDoc: boolean
  /** 按标识真正加载文章（读 localStorage / 内置目录） */
  onPick: (ref: string) => void
  /** 关掉当前文章、回到列表 */
  onClear: () => void
}

/**
 * 让「URL ↔ 当前文章」保持同步。返回一个 `pick(ref)` 给文章选择器用。
 *
 * 四条规则：
 *   ① 有文章但 URL 还没写它（首屏恢复 / 索引刚建好）→ **replace** 补上，不新增历史层；
 *   ② URL 指向另一篇（前进/后退、直接粘地址、点选择器）→ 加载它；
 *   ③ URL 里没有文章而当前有 → 关掉文章回列表（就是用户按了返回）；
 *   ④ 点选择器只导航（push），加载交给 ②。
 *
 * 于是阅读页内部是**真正的一层层历史**：
 *   `/reader` → `/reader/a/<这篇>` → `/reader/a/<这篇>/p/<面板>`
 * 返回键逐层退回（关面板 → 回文章 → 回列表），最后才离开阅读页。
 *
 * 回调存在 ref 里：`onPick` / `onClear` 每次渲染都是新函数（闭包了最新 state），
 * 直接进依赖数组会让 effect 反复触发，把「已经加载好的文章」重新加载一遍。
 */
export function useArticleRoute({
  routeSlug,
  currentRef,
  slugOf,
  refOf,
  indexReady,
  hasDoc,
  onPick,
  onClear,
}: UseArticleRouteParams): (ref: string) => void {
  const navigate = useNavigate()
  const pickRef = useRef(onPick)
  pickRef.current = onPick
  const clearRef = useRef(onClear)
  clearRef.current = onClear
  /** 是否曾经打开过文章 —— 没有过就别把「空 URL」当成"用户按了返回"。 */
  const everHadDoc = useRef(false)

  useEffect(() => {
    if (hasDoc) everHadDoc.current = true
  }, [hasDoc])

  // ① 有文章、URL 里却没有它 → 补上，而且是 **push**（必须新增一层）
  //
  // 这里以前用 `replace`，结果是：打开 `/reader` 恢复出文章后，历史里的
  // `/reader` 被覆盖成 `/reader/a/xxx`，按返回键直接离开阅读页 —— 用户说的
  // 「按返回键直接返回主页面」就是这个。改成 push 之后历史是
  //   [主界面] → /reader → /reader/a/<这篇>
  // 返回键先回文章列表，再按一次才离开。
  //
  // 用户按返回时（routeSlug 已经变空）不会再走这里；刷新时 URL 里本来就有 slug，
  // ① 也直接 return，所以不会越堆越多。
  useEffect(() => {
    if (!hasDoc || !currentRef) return
    if (routeSlug) return // URL 已经有主：要么就是这篇，要么交给 ② 换文章
    const slug = slugOf(currentRef)
    if (!slug) return // 索引里还没有它（目录仍在加载），等下一轮
    navigate(articlePath(slug))
  }, [hasDoc, currentRef, slugOf, routeSlug, navigate])

  // ② URL 指向另一篇 → 加载
  useEffect(() => {
    if (!indexReady || !routeSlug) return
    const ref = refOf(routeSlug)
    // 认不出这个 slug：链接指向的文章已经不在库里，停在列表页比乱开一篇好
    if (!ref || ref === currentRef) return
    pickRef.current(ref)
  }, [indexReady, routeSlug, refOf, currentRef])

  // ③ URL 里没有文章而当前有 → 关掉，回列表
  useEffect(() => {
    if (routeSlug || !hasDoc || !everHadDoc.current) return
    clearRef.current()
  }, [routeSlug, hasDoc])

  /**
   * 文章选择器：先导航（真实的 URL + 历史层），加载由 ② 完成。
   *
   * 索引还没建好时算不出 slug，这时**直接加载**、URL 留空 —— ① 会在索引到齐后补上。
   * 千万别在这里 `return`：那会变成「点了没反应」。
   */
  return useCallback(
    (ref: string) => {
      const slug = slugOf(ref)
      if (!slug) {
        pickRef.current(ref)
        return
      }
      navigate(articlePath(slug))
    },
    [navigate, slugOf],
  )
}
