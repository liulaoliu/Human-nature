import { useCallback, useRef } from 'react'
import type { SessionKey } from './sessionKeys'

/**
 * 会话关闭注册表：每个会话把自己的 close 动作登记进来，开另一个会话时按组关闭。
 *
 * 以前每个「开始」函数都手抄一串 `closeOthers`，新增会话时漏一个就是两个会话
 * 同时开着（快捷键互相抢、正文一起让位）。收口到这里之后，规则只有一处：
 * 开学习组关学习组、开输出组先关学习组、临时会话（快刷/听写）按需清。
 */
export function useSessionClosers() {
  const closers = useRef<Partial<Record<SessionKey, () => void>>>({})
  const closeSessions = useCallback((...keys: SessionKey[]) => {
    for (const key of keys) closers.current[key]?.()
  }, [])
  /** 快刷 / 听写这两个临时会话：开别的会话时顺手关掉。 */
  const closeTransient = useCallback(() => closeSessions('quick', 'dictation'), [closeSessions])

  return { closers, closeSessions, closeTransient }
}
