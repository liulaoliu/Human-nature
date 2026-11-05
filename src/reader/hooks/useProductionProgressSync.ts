import { useEffect, useRef } from 'react'
import type { WritingRecord } from '../../core/writing'
import { writingRecordKey } from '../../core/writing'
import {
  applyProductionProgressRecords,
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

function recordSignature(rec: WritingRecord): string {
  const hits = rec.task && 'hits' in rec.task ? (rec.task as { hits?: unknown }).hits : []
  return JSON.stringify(hits ?? [])
}

/**
 * 目标块进度表以 attempts 为准：
 * - 首次加载：有表就信任表，没表就从历史全量回填；
 * - 之后新记录只做增量 upsert；
 * - 删除 / 手工改命中 / 外部导入导致记录指纹变化时回退全量重算。
 */
export function useProductionProgressSync({
  records,
  stored = [],
  setStored,
}: UseProductionProgressSyncParams) {
  const seenRef = useRef<Map<string, string>>(new Map())
  const progressRef = useRef<ProductionProgress[]>([])
  const storedSigRef = useRef('')
  const initializedRef = useRef(false)

  useEffect(() => {
    if (!setStored) return
    const current = new Map(records.map((rec) => [writingRecordKey(rec), recordSignature(rec)]))
    const storedSig = signature(stored)

    if (!initializedRef.current) {
      initializedRef.current = true
      if (stored.length > 0) {
        progressRef.current = [...stored]
        seenRef.current = current
        storedSigRef.current = storedSig
        return
      }
      const derived = deriveProductionProgress(records)
      progressRef.current = derived
      seenRef.current = current
      storedSigRef.current = signature(derived)
      if (derived.length) setStored(derived)
      return
    }

    // 外部改了表（备份导入 / 清空）：以 attempts 重算，避免读旧表。
    if (storedSig !== storedSigRef.current) {
      const derived = deriveProductionProgress(records)
      progressRef.current = derived
      seenRef.current = current
      storedSigRef.current = signature(derived)
      setStored(derived)
      return
    }

    let full = false
    for (const [key, sig] of seenRef.current) {
      if (current.get(key) !== sig) {
        full = true
        break
      }
    }
    if (full) {
      const derived = deriveProductionProgress(records)
      progressRef.current = derived
      seenRef.current = current
      storedSigRef.current = signature(derived)
      setStored(derived)
      return
    }

    const fresh = records.filter((rec) => !seenRef.current.has(writingRecordKey(rec)))
    if (!fresh.length) return
    const next = applyProductionProgressRecords(progressRef.current, fresh)
    for (const rec of fresh) seenRef.current.set(writingRecordKey(rec), recordSignature(rec))
    progressRef.current = next
    storedSigRef.current = signature(next)
    setStored(next)
  }, [records, stored, setStored])
}
