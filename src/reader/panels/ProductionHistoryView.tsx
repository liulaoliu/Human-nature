import type { ProductionProgress } from '../../core/productionHistory'
import type { WritingRecord } from '../../core/writing'
import type { ProductionRouteState } from '../route'
import ProductionHistoryPanel from './ProductionHistoryPanel'

export interface ProductionHistoryViewProps {
  open: boolean
  records: WritingRecord[]
  progress: readonly ProductionProgress[]
  articleIdentity: string
  articleTitle: string
  onBack: () => void
  /** 历史筛选（模式 / 范围 / 主题 / 目标块）也走 URL，写入方只有 `route.ts` 一处 */
  route?: ProductionRouteState
  onNavigate?: (state: ProductionRouteState, opts?: { replace?: boolean }) => void
}

/** 历史子视图的薄包装：让工棚主面板不必再铺一层 props。 */
export default function ProductionHistoryView({
  open,
  records,
  progress,
  articleIdentity,
  articleTitle,
  onBack,
  route,
  onNavigate,
}: ProductionHistoryViewProps) {
  if (!open) return null
  return (
    <ProductionHistoryPanel
      records={records}
      progress={progress}
      articleIdentity={articleIdentity}
      articleTitle={articleTitle}
      onBack={onBack}
      route={route}
      onNavigate={onNavigate}
    />
  )
}
