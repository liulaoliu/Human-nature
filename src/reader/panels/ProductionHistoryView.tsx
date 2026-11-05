import type { ProductionProgress } from '../../core/productionHistory'
import type { WritingRecord } from '../../core/writing'
import ProductionHistoryPanel from './ProductionHistoryPanel'

export interface ProductionHistoryViewProps {
  open: boolean
  records: WritingRecord[]
  progress: ProductionProgress[]
  articleIdentity: string
  articleTitle: string
  onBack: () => void
}

/** 历史子视图的薄包装：让工棚主面板不必再铺一层 props。 */
export default function ProductionHistoryView({
  open,
  records,
  progress,
  articleIdentity,
  articleTitle,
  onBack,
}: ProductionHistoryViewProps) {
  if (!open) return null
  return (
    <ProductionHistoryPanel
      records={records}
      progress={progress}
      articleIdentity={articleIdentity}
      articleTitle={articleTitle}
      onBack={onBack}
    />
  )
}
