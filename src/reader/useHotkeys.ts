import { useEffect, useRef } from 'react'
import { registerHotkeys } from './hotkeys'

/**
 * 把 `handler` 注册成全局快捷键，`enabled=false` 时注销。
 * `priority` 高的模式独占键盘；同优先级会同时收到事件。
 */
export function useHotkeys(handler: (e: KeyboardEvent) => void, enabled = true, priority = 10): void {
  const ref = useRef(handler)
  ref.current = handler

  useEffect(() => {
    if (!enabled) return
    return registerHotkeys(priority, (e) => ref.current(e))
  }, [enabled, priority])
}
