import { useSyncExternalStore } from 'react'
import type { SessionState } from '../state/session'

/** ViewModel → View 的唯一通道。React 不直接碰 store 内部。 */
export function useSession<T>(store: { getState: () => T; subscribe: (cb: () => void) => () => void }): T {
  return useSyncExternalStore(store.subscribe, store.getState, store.getState)
}

export type { SessionState }
