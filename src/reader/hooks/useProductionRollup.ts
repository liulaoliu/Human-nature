import { useMemo, type Dispatch, type SetStateAction } from 'react'
import type { WritingRecord } from '../../core/writing'
import type { AnswerEvent } from '../../core/answerEvents'
import type { WritingErrorProgress } from '../../core/writingErrorProgress'
import type { ProductionProgress } from '../../core/productionHistory'
import { deriveProductionProgress, productionRecords } from '../../core/productionHistory'
import { useProductionErrors } from './useProductionErrors'
import { useProductionProgressSync } from './useProductionProgressSync'
import { useProductionHistoryView } from './useProductionHistoryView'

export interface UseProductionRollupParams {
  writingHistory: WritingRecord[]
  /** 错因复习：产出批改的 must-fix 也写进同一套错因卡。 */
  writingErrorProgress?: readonly WritingErrorProgress[]
  setWritingErrorProgress?: Dispatch<SetStateAction<WritingErrorProgress[]>>
  productionProgress?: readonly ProductionProgress[]
  setProductionProgress?: Dispatch<SetStateAction<ProductionProgress[]>>
  answerEvents?: readonly AnswerEvent[]
  articleIdentity: string
  now: () => Date
}

/**
 * 产出记录的三份派生视图：错因复习 / 目标块进度 / 历史统计。
 *
 * 它们都吃同一份 `allHistory`（`writingRecords` 里 `source='production'` 的那些），
 * 所以在这里一次算出来，会话 hook 只负责把结果嵌进 model。
 */
export function useProductionRollup({
  writingHistory,
  writingErrorProgress,
  setWritingErrorProgress,
  productionProgress,
  setProductionProgress,
  answerEvents,
  articleIdentity,
  now,
}: UseProductionRollupParams) {
  const allHistory = useMemo(() => productionRecords(writingHistory), [writingHistory])
  useProductionErrors({ records: allHistory, writingErrorProgress, setWritingErrorProgress, answerEvents, now })
  useProductionProgressSync({ records: allHistory, stored: productionProgress, setStored: setProductionProgress })
  const derivedProgress = useMemo(() => deriveProductionProgress(allHistory), [allHistory])
  const progress = useMemo(
    () => (productionProgress && productionProgress.length ? productionProgress : derivedProgress),
    [productionProgress, derivedProgress],
  )
  const { stats, history } = useProductionHistoryView(allHistory, articleIdentity)
  return { allHistory, progress, stats, history }
}
