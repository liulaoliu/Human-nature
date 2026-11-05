import { useEffect, useRef, useState } from 'react'
import {
  assignLegacyProductionSessionIds,
  type LegacyProductionGroup,
} from '../../core/productionHistory'
import type { WritingRecord } from '../../core/writing'
import { readJson, writeJson } from '../storage'

export const PRODUCTION_LEGACY_BACKUP_KEY = 'reader:productionLegacyBackup'
export const PRODUCTION_LEGACY_REPORT_KEY = 'reader:productionLegacyReport'

export interface ProductionLegacyMigrationReport {
  at: string
  changed: number
  groups: LegacyProductionGroup[]
  backupKey: string
}

export interface UseProductionLegacyMigrationParams {
  records: WritingRecord[]
  setRecords: (records: WritingRecord[]) => void
  flash?: (message: string) => void
}

function isGroup(value: unknown): value is LegacyProductionGroup {
  if (!value || typeof value !== 'object') return false
  const g = value as Record<string, unknown>
  return (
    typeof g.sessionId === 'string' &&
    typeof g.articleId === 'string' &&
    typeof g.day === 'string' &&
    typeof g.mode === 'string' &&
    typeof g.topic === 'string' &&
    typeof g.count === 'number' &&
    typeof g.firstAt === 'string' &&
    typeof g.lastAt === 'string'
  )
}

function isReport(value: unknown): value is ProductionLegacyMigrationReport {
  if (!value || typeof value !== 'object') return false
  const r = value as Record<string, unknown>
  return (
    typeof r.at === 'string' &&
    typeof r.changed === 'number' &&
    Array.isArray(r.groups) &&
    r.groups.every(isGroup) &&
    typeof r.backupKey === 'string'
  )
}

function readReport(): ProductionLegacyMigrationReport | null {
  const raw = readJson<unknown>(PRODUCTION_LEGACY_REPORT_KEY, null)
  return isReport(raw) ? raw : null
}

/**
 * 一次性补旧产出稿的 sessionId。迁移前把原历史写进本机备份键，
 * 并把归组明细落一份报告；之后记录都带 id，下一次 effect 自然不会再写。
 */
export function useProductionLegacyMigration({
  records,
  setRecords,
  flash,
}: UseProductionLegacyMigrationParams) {
  const [report, setReport] = useState<ProductionLegacyMigrationReport | null>(readReport)
  const attemptedRef = useRef('')

  useEffect(() => {
    const { records: next, changed, groups } = assignLegacyProductionSessionIds(records)
    if (!changed) return
    const fingerprint = JSON.stringify(
      records
        .filter((rec) => rec.source === 'production')
        .map((rec) => [rec.at, rec.articleId, (rec.task as { topic?: string } | null)?.topic ?? '']),
    )
    if (attemptedRef.current === fingerprint) return
    attemptedRef.current = fingerprint
    try {
      writeJson(PRODUCTION_LEGACY_BACKUP_KEY, records)
    } catch {
      // 备份失败不阻止归组；原记录仍在 history 里
    }
    const nextReport: ProductionLegacyMigrationReport = {
      at: new Date().toISOString(),
      changed,
      groups,
      backupKey: PRODUCTION_LEGACY_BACKUP_KEY,
    }
    try {
      writeJson(PRODUCTION_LEGACY_REPORT_KEY, nextReport)
    } catch {
      // 报告写不进去不影响迁移本身
    }
    setReport(nextReport)
    setRecords(next)
    flash?.(`已把 ${changed} 条旧产出记录归成 ${groups.length} 组；原历史已留本机备份`)
  }, [records, setRecords, flash])

  return { report }
}
