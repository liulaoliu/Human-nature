import { useCallback, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { articlePath } from '../route'

export interface UseArticleRouteParams {
  /** URL 里的文章 ref（空串 = 没打开文章） */
  routeRef: string
  /** 当前已经打开的那篇的 ref */
  currentRef: string
  hasDoc: boolean
  /** 按 ref 真正加载文章（去读 localStorage / 内置文章） */
  onPick: (ref: string) => void
  /** 关掉当前文章、回到列表 */
  onClear: () => void
}

/**
 * 让「URL ↔ 当前文章」保持同步。返回一个 `pick(ref)` 给文章选择器用。
 *
 * 三条规则（从 `ReaderApp` 里抽出来的，原来凑在一起不好读）：
 *   ① 首屏从 localStorage 恢复出文章时，把 URL 补成 `/reader/a/<ref>`（用 replace，
 *      不往历史里堆一层空的），否则用户按返回会先回到「没文章」的状态。
 *   ② URL 指向另一篇（前进/后退、直接粘地址、点选择器）→ 按 URL 加载。
 *   ③ URL 里没有文章而当前有 → 关掉文章回列表。
 *
 * 回调存在 ref 里：`onPick` / `onClear` 每次渲染都是新函数（它们闭包了最新 state），
 * 直接进依赖数组会让 effect 反复触发，把「已经加载好的文章」重新加载一遍。
 */
export function useArticleRoute({
  routeRef,
  currentRef,
  hasDoc,
  onPick,
  onClear,
}: UseArticleRouteParams): (ref: string) => void {
  const navigate = useNavigate()
  /** 是否已经做过一次「URL ↔ 文章」的同步（没同步过就别急着关文章）。 */
  const synced = useRef(false)
  const pickRef = useRef(onPick)
  pickRef.current = onPick
  const clearRef = useRef(onClear)
  clearRef.current = onClear

  useEffect(() => {
    if (synced.current || !hasDoc) return
    synced.current = true
    if (currentRef) navigate(articlePath(currentRef), { replace: true })
  }, [hasDoc, currentRef, navigate])

  useEffect(() => {
    if (!routeRef || routeRef === currentRef) return
    synced.current = true
    pickRef.current(routeRef)
  }, [routeRef, currentRef])

  useEffect(() => {
    if (routeRef || !hasDoc || !synced.current) return
    clearRef.current()
  }, [routeRef, hasDoc])

  /** 文章选择器：只导航，真正加载交给上面第 ② 条。 */
  return useCallback(
    (ref: string) => {
      synced.current = true
      navigate(articlePath(ref))
    },
    [navigate],
  )
}
