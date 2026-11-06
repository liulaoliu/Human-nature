import type { useProductionYogurtPairs } from '../../hooks/useProductionYogurtPairs'

export type ProductionYogurt = ReturnType<typeof useProductionYogurtPairs>

export interface YogurtPairEditorProps {
  yogurt: ProductionYogurt
  sourceLabel: string
  referenceLabel: string
  /** 有的话在底部多一个「应用到这一组」：中途改断句时写回会话 */
  onApply?: () => void
  applyLabel?: string
  onCancel?: () => void
}

/**
 * 风味酸奶的断句对齐编辑器：每对两张 textarea + 上移 / 下移 / 合并 / 拆开 / 删除。
 *
 * 选草料屏（第一次拆句）和挤奶屏（做了一半改断句）共用这一份；
 * 状态在 `useProductionYogurtPairs`，这里只画和转发操作。
 */
export default function YogurtPairEditor({
  yogurt,
  sourceLabel,
  referenceLabel,
  onApply,
  applyLabel = '应用断句',
  onCancel,
}: YogurtPairEditorProps) {
  const pairs = yogurt.pairs
  // 还没拆过：只可能是在预览失败后进来的，把错误露出来，别整块消失
  if (!pairs) return yogurt.error ? <div className="production-error">{yogurt.error}</div> : null
  return (
    <div className="production-pairs">
      {yogurt.error && <div className="production-error">{yogurt.error}</div>}
      {yogurt.warning && <div className="production-notice">{yogurt.warning}</div>}
      {pairs.map((pair, i) => (
        <div className="production-pair" key={`${i}-${pair.source.slice(0, 8)}`}>
          <div className="muted">第 {i + 1} 对</div>
          <textarea
            aria-label={`第${i + 1}对原文`}
            rows={2}
            value={pair.source}
            onChange={(e) => yogurt.updatePair(i, { source: e.target.value })}
            placeholder={sourceLabel}
          />
          <textarea
            aria-label={`第${i + 1}对参考译文`}
            rows={2}
            value={pair.reference}
            onChange={(e) => yogurt.updatePair(i, { reference: e.target.value })}
            placeholder={referenceLabel}
          />
          <div className="bar">
            <button onClick={() => yogurt.movePair(i, -1)} disabled={i === 0}>
              上移
            </button>
            <button onClick={() => yogurt.movePair(i, 1)} disabled={i === pairs.length - 1}>
              下移
            </button>
            <button onClick={() => yogurt.mergeNextPair(i)} disabled={i === pairs.length - 1}>
              合并下一对
            </button>
            <button onClick={() => yogurt.splitPair(i)}>拆成两句</button>
            <button onClick={() => yogurt.deletePair(i)}>删除</button>
          </div>
        </div>
      ))}
      <div className="bar">
        <button onClick={yogurt.addPair}>＋ 加一对</button>
        {onApply && (
          <button className="primary" onClick={onApply}>
            {applyLabel}
          </button>
        )}
        {onCancel && <button onClick={onCancel}>取消</button>}
      </div>
    </div>
  )
}
