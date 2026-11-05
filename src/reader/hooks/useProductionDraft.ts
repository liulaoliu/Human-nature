import { useCallback } from 'react'
import { normalizeProductionDraft, PRODUCTION_DRAFT_KEY, type ProductionDraft } from '../../core/productionDraft'
import { readJson, removeRaw, reportStorageFailure, writeRaw } from '../storage'

type DraftMap = Record<string, ProductionDraft>

function readMap(): DraftMap {
  const raw = readJson<unknown>(PRODUCTION_DRAFT_KEY, null)
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  // 兼容第一版单草稿格式（对象本身带 version/articleId）。
  const candidate = raw as Record<string, unknown>
  if (candidate.version === 1 && typeof candidate.articleId === 'string') {
    const draft = normalizeProductionDraft(candidate)
    return draft ? { [draft.articleId]: draft } : {}
  }
  const out: DraftMap = {}
  for (const value of Object.values(candidate)) {
    const draft = normalizeProductionDraft(value)
    if (draft) out[draft.articleId] = draft
  }
  return out
}

/**
 * 会话草稿的 localStorage 读写。按文章保留最近 5 组，切文章不会互相覆盖。
 * 只存当前这一组「写到一半」的状态；提交稿仍走 writingHistory / SQLite。
 */
export function useProductionDraft(articleId: string) {
  const key = articleId || 'manual'
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
