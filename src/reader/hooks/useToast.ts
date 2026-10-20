import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * 顶部提示条：`flash(msg)` 显示，`durationMs` 后自动清空。
 *
 * 连续 flash 时先清掉上一个定时器——否则旧 timer 会把新消息提前清掉。
 * 卸载时清定时器，避免对已卸载组件 setState。
 */
export function useToast(durationMs = 1900) {
  const [toast, setToast] = useState('')
  const timerRef = useRef<number | null>(null)

  const flash = useCallback(
    (message: string) => {
      setToast(message)
      if (timerRef.current != null) window.clearTimeout(timerRef.current)
      timerRef.current = window.setTimeout(() => {
        timerRef.current = null
        setToast('')
      }, durationMs)
    },
    [durationMs],
  )

  useEffect(() => {
    return () => {
      if (timerRef.current != null) window.clearTimeout(timerRef.current)
    }
  }, [])

  return { toast, flash }
}
