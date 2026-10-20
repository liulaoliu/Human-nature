import { useCallback, useEffect, useLayoutEffect, useRef, type RefObject } from 'react'
import { scrollRatioOf, scrollTopOf } from '../../core/scrollProgress'
import { readScroll, saveScroll } from '../../state/scrollPrefs'

/**
 * 阅读页滚动进度的持久化：滚到哪记到哪（按文章），换篇 / 重开都回到原处。
 *
 * - **内存优先**：`state/scrollPrefs` 里有一份会话缓存，切文章再切回来是它的活；
 *   只有整个页面重开（缓存空了）才回落到 localStorage。
 * - **节流**：scroll 事件很密，这里只记「最新的比例」，停止滚动 400ms 后落一次盘
 *   （还是 trailing 节流，滚动过程中不会一直写 localStorage）。
 * - **换篇**：先把上一篇没落盘的那一笔写掉，再按这篇自己的进度恢复；
 *   正文高度还没铺开（可滚区间 0）时不恢复也不记，免得把「还没渲染完」当成滚到顶。
 *
 * `docKey` 由调用方拼成「文章标识 + 正文签名」（见 `core/docSignature`）：只按标识存，
 * 空标题 / 同名的两篇文章会互相继承滚动位置。
 *
 * 展示层只拿到这个 hook，不直接碰 localStorage（架构门禁 R3）。
 */
export const SCROLL_SAVE_DELAY_MS = 400

export function useReadingScroll(ref: RefObject<HTMLElement | null>, docKey: string): void {
  /** 待落盘的最新比例（null = 没有新变化）。 */
  const pendingRatio = useRef<number | null>(null)
  /** 待落盘那笔属于哪篇文章（换篇时先把它写回旧文章）。 */
  const pendingKey = useRef(docKey)
  const timer = useRef<number | null>(null)
  /** 正在程序化恢复位置：这期间的 scroll 事件不算用户滚动。 */
  const restoring = useRef(false)

  const flush = useCallback(() => {
    if (timer.current != null) {
      window.clearTimeout(timer.current)
      timer.current = null
    }
    const ratio = pendingRatio.current
    const key = pendingKey.current
    pendingRatio.current = null
    if (ratio == null || !key) return
    saveScroll(key, ratio)
  }, [])

  const onScroll = useCallback(() => {
    const el = ref.current
    if (!el || restoring.current) return
    // 内容还没铺开（可滚区间 0）时别记：否则会把「渲染中」当成滚到顶
    if (!(el.scrollHeight - el.clientHeight > 0)) return
    pendingRatio.current = scrollRatioOf(el.scrollTop, el.scrollHeight - el.clientHeight)
    pendingKey.current = docKey
    if (timer.current != null) return
    timer.current = window.setTimeout(flush, SCROLL_SAVE_DELAY_MS)
  }, [docKey, flush, ref])

  // 换篇：先结清上一篇的账，再恢复到这篇上次的位置
  useLayoutEffect(() => {
    flush()
    const el = ref.current
    if (!el || !docKey) return

    const restore = () => {
      const ratio = readScroll(docKey)
      if (ratio <= 0) return
      const scrollable = el.scrollHeight - el.clientHeight
      if (scrollable <= 0) return
      restoring.current = true
      el.scrollTop = scrollTopOf(ratio, scrollable)
      restoring.current = false
    }
    restore()
    // 字号 / 图片 / 译文让高度晚一拍才定的情况：没滚到位就再补一次（只补一次，不轮询）
    if (el.scrollTop === 0 && readScroll(docKey) > 0) {
      const id = window.setTimeout(restore, 0)
      return () => window.clearTimeout(id)
    }
  }, [docKey, flush, ref])

  // 监听滚动（passive：不拖累滚动性能）
  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.addEventListener('scroll', onScroll, { passive: true })
    return () => el.removeEventListener('scroll', onScroll)
  }, [onScroll, ref])

  // 关页面 / 卸载时把还没落盘的一笔写掉（刚滚完就关标签页也不会丢）
  useEffect(() => {
    return () => {
      flush()
      window.removeEventListener('pagehide', flush)
    }
  }, [flush])

  useEffect(() => {
    window.addEventListener('pagehide', flush)
  }, [flush])
}
