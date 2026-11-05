import { useEffect } from 'react'
import { assignLegacyProductionSessionIds } from '../../core/productionHistory'
import type { WritingRecord } from '../../core/writing'
import { writeJson } from '../storage'

export const PRODUCTION_LEGACY_BACKUP_KEY = 'reader:productionLegacyBackup'

export interface UseProductionLegacyMigrationParams {
  records: WritingRecord[]
  setRecords: (records: WritingRecord[]) => void
  flash?: (message: string) => void
}

/**
 * 一次性补旧产出稿的 sessionId。迁移前把原历史写进本机备份键；
 * 迁移后记录都带 id，下一次 effect 自然不会再写。
 */
export function useProductionLegacyMigration({
  records,
  setRecords,
  flash,
}: UseProductionLegacyMigrationParams) {
  useEffect(() => {
    const { records: next, changed } = assignLegacyProductionSessionIds(records)
    if (!changed) return
    try {
      writeJson(PRODUCTION_LEGACY_BACKUP_KEY, records)
    } catch {
      // 备份失败不阻止归组；原记录仍在 history 里
    }
    setRecords(next)
    flash?.(`已把 ${changed} 条旧产出记录归组；原历史已留本机备份`)
  }, [records, setRecords, flash])
}
