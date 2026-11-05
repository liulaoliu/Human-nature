import { useEffect } from 'react'
import type { WritingRecord } from '../../core/writing'
import {
  deriveProductionProgress,
  type ProductionProgress,
} from '../../core/productionHistory'

export interface UseProductionProgressSyncParams {
  records: readonly WritingRecord[]
  stored?: readonly ProductionProgress[]
  setStored?: (progress: ProductionProgress[]) => void
}

function signature(progress: readonly ProductionProgress[]): string {
  return progress
    .map(
      (p) =>
        `${p.key}|${p.attempts}|${p.hits}|${p.misses}|${p.streak}|${p.lastAt}|${p.dueAt}|${p.updatedAt ?? ''}`,
    )
    .join('\n')
}

/**
 * 目标块进度表以 attempts 为准：每次历史变化重算一次进度并落表。
 * 表用于跨次启动 / 备份 / 未来加速；当前仍保留现算，避免历史导入后表漂移。
 */
export function useProductionProgressSync({
  records,
  stored = [],
  setStored,
}: UseProductionProgressSyncParams) {
  useEffect(() => {
    if (!setStored) return
    const derived = deriveProductionProgress(records)
    if (!derived.length) return
    if (signature(derived) === signature(stored)) return
    setStored(derived)
  }, [records, stored, setStored])
}
