import { useMemo } from 'react'
import type { WritingRecord } from '../../core/writing'
import { productionStats } from '../../core/productionHistory'

/** 工棚面板用的派生视图：本篇文章最近 8 条 + 全库统计。 */
export function useProductionHistoryView(
  allHistory: readonly WritingRecord[],
  articleIdentity: string,
) {
  const stats = useMemo(() => productionStats(allHistory), [allHistory])
  const history = useMemo(
    () =>
      allHistory.filter((r) => !articleIdentity || r.articleId === articleIdentity).slice(0, 8),
    [allHistory, articleIdentity],
  )
  return { stats, history }
}
