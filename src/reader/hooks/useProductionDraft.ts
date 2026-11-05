import { useCallback, useEffect, useRef } from 'react'
import {
  normalizeProductionDraft,
  normalizeProductionDraftMap,
  PRODUCTION_DRAFT_KEY,
  type ProductionDraft,
} from '../../core/productionDraft'
import { readJson, removeRaw, reportStorageFailure, writeRaw } from '../storage'

type DraftMap = Record<string, ProductionDraft>
const CHANNEL = 'reader:productionDraft'

function readMap(): DraftMap {
  return normalizeProductionDraftMap(readJson<unknown>(PRODUCTION_DRAFT_KEY, null))
}

/**
 * 会话草稿的 localStorage 读写。
 * 同一浏览器的其它标签页通过 BroadcastChannel / storage 事件收到更新；
 * 冲突由调用方按草稿 `at` 决定是否采用。
 */
export function useProductionDraft(
  articleId: string,
  onRemote?: (draft: ProductionDraft) => void,
) {
  const key = articleId || 'manual'
  const remoteRef = useRef(onRemote)
  remoteRef.current = onRemote
  const channelRef = useRef<BroadcastChannel | null>(null)

  useEffect(() => {
    const channel =
      typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel(CHANNEL) : null
    channelRef.current = channel
    if (channel) {
      channel.onmessage = (event: MessageEvent) => {
        const data = event.data as { type?: unknown; draft?: unknown } | null
        if (!data || data.type !== 'save') return
        const draft = normalizeProductionDraft(data.draft)
        if (draft?.articleId === key) remoteRef.current?.(draft)
      }
    }
    const onStorage = (event: StorageEvent) => {
      if (event.key !== PRODUCTION_DRAFT_KEY || !event.newValue) return
      try {
        const map = normalizeProductionDraftMap(JSON.parse(event.newValue))
        const draft = map[key]
        if (draft) remoteRef.current?.(draft)
      } catch {
        // 坏 JSON 不处理；本地读取时还有 normalize 兜底
      }
    }
    if (typeof window !== 'undefined') window.addEventListener('storage', onStorage)
    return () => {
      channel?.close()
      if (channelRef.current === channel) channelRef.current = null
      if (typeof window !== 'undefined') window.removeEventListener('storage', onStorage)
    }
  }, [key])

  const load = useCallback(() => readMap()[key] ?? null, [key])
  const save = useCallback((draft: ProductionDraft) => {
    try {
      const map = { ...readMap(), [draft.articleId]: draft }
      const trimmed = Object.fromEntries(
        Object.entries(map)
          .sort(([, a], [, b]) => b.at.localeCompare(a.at))
          .slice(0, 5),
      )
      if (!writeRaw(PRODUCTION_DRAFT_KEY, JSON.stringify(trimmed))) {
        reportStorageFailure(PRODUCTION_DRAFT_KEY, new Error('write failed'))
      } else {
        channelRef.current?.postMessage({ type: 'save', draft })
      }
    } catch (error) {
      reportStorageFailure(PRODUCTION_DRAFT_KEY, error)
    }
  }, [])
  const clear = useCallback(() => {
    const map = readMap()
    delete map[key]
    if (!Object.keys(map).length) removeRaw(PRODUCTION_DRAFT_KEY)
    else writeRaw(PRODUCTION_DRAFT_KEY, JSON.stringify(map))
  }, [key])
  return { load, save, clear }
}
