import { useCallback, useEffect, useRef } from 'react'

/**
 * 一个延迟动作：重复调度会覆盖上一个，卸载 / 手动 clear 都会取消。
 *
 * 考试「自动下一题」和听写「全对自动下一句」原来是两份一样的
 * `useRef + window.setTimeout + useEffect cleanup`，抽到这里只留一份。
 */
export function useDelayedAction() {
  const timerRef = useRef<number | null>(null)

  const clear = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current)
      timerRef.current = null
    }
  }, [])

  const schedule = useCallback(
    (delay: number, action: () => void) => {
      clear()
      timerRef.current = window.setTimeout(() => {
        timerRef.current = null
        action()
      }, delay)
    },
    [clear],
  )

  useEffect(() => clear, [clear])

  return { clear, schedule }
}
