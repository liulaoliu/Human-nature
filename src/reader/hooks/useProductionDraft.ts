import { useCallback, useEffect, useRef } from 'react'
import {
  normalizeProductionDraft,
  normalizeProductionDraftMap,
  productionDraftKey,
  PRODUCTION_DRAFT_KEY,
  type ProductionDraft,
} from '../../core/productionDraft'
import type { ProductionMode } from '../../core/production'
import { readJson, removeRaw, reportStorageFailure, writeRaw } from '../storage'

type DraftMap = Record<string, ProductionDraft>
const CHANNEL = 'reader:productionDraft'

function readMap(): DraftMap {
  return normalizeProductionDraftMap(readJson<unknown>(PRODUCTION_DRAFT_KEY, null))
}

/**
 * 会话草稿的 localStorage 读写。
 *
 * 键是「文章 + 模式」：风味酸奶暂停着也能开全脂，两组草稿互不覆盖。
 * 同一浏览器的其它标签页通过 BroadcastChannel / storage 事件收到更新；
 * 冲突由调用方按草稿 `at` 决定是否采用。
 */
export function useProductionDraft(
  articleId: string,
  mode: ProductionMode,
  onRemote?: (draft: ProductionDraft) => void,
) {
  const base = articleId || 'manual'
  const key = productionDraftKey(base, mode)
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
        if (draft && productionDraftKey(draft.articleId, draft.mode) === key) {
          remoteRef.current?.(draft)
        }
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
  /** 打开工棚时用：这篇文章里最新的一组（不管哪种吃法）。 */
  const loadNewest = useCallback((): ProductionDraft | null => {
    const mine = Object.values(readMap()).filter((d) => d.articleId === base)
    mine.sort((a, b) => b.at.localeCompare(a.at))
    return mine[0] ?? null
  }, [base])
  /** 选草料屏用：这篇文章各吃法各停在哪一题。 */
  const listMine = useCallback((): ProductionDraft[] => {
    return Object.values(readMap())
      .filter((d) => d.articleId === base)
      .sort((a, b) => b.at.localeCompare(a.at))
  }, [base])
  const save = useCallback((draft: ProductionDraft) => {
    try {
      const map = readMap()
      const mapKey = productionDraftKey(draft.articleId, draft.mode)
      const old = map[mapKey]
      const winner = old && old.at > draft.at ? old : draft
      map[mapKey] = winner
      const trimmed = Object.fromEntries(
        Object.entries(map)
          .sort(([, a], [, b]) => b.at.localeCompare(a.at))
          .slice(0, 9),
      )
      if (!writeRaw(PRODUCTION_DRAFT_KEY, JSON.stringify(trimmed))) {
        reportStorageFailure(PRODUCTION_DRAFT_KEY, new Error('write failed'))
      } else if (winner === draft) {
        channelRef.current?.postMessage({ type: 'save', draft })
      }
    } catch (error) {
      reportStorageFailure(PRODUCTION_DRAFT_KEY, error)
    }
  }, [])
  /** 清掉某种吃法的草稿（默认清当前挂着的这种）。 */
  const clearFor = useCallback(
    (clearMode: ProductionMode = mode) => {
      const map = readMap()
      delete map[productionDraftKey(base, clearMode)]
      if (!Object.keys(map).length) removeRaw(PRODUCTION_DRAFT_KEY)
      else writeRaw(PRODUCTION_DRAFT_KEY, JSON.stringify(map))
    },
    [base, mode],
  )
  return { load, loadNewest, listMine, save, clear: clearFor, clearFor }
}
