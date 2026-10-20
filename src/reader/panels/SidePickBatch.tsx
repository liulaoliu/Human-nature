/** 「选词模式」里攒的待选生词。 */
import type { VocabVia } from '../../types/document'

export interface BatchItem {
  word: string
  sentence: string
  sentenceId: string | null
  /** 来源：手动点选 / 离线词典挑词 / AI 自动标词；旧待选没有这个字段 */
  via?: VocabVia
}

export interface SidePickBatchProps {
  /** 待选清单（只含未入库的词）。 */
  visibleBatch: BatchItem[]
  /** 待选总数（含已入库、不再显示的词）。 */
  batchCount: number
  onRemoveWord: (b: BatchItem) => void
  onCommitBatch: () => void
  onCopyBatchPrompt: () => void
  onExportBatch: () => void
  onClearBatch: () => void
}

/** 待选区：挑出来的词、批量入库/导出，以及「都已在生词本里」的提示。 */
export default function SidePickBatch({
  visibleBatch,
  batchCount,
  onRemoveWord,
  onCommitBatch,
  onCopyBatchPrompt,
  onExportBatch,
  onClearBatch,
}: SidePickBatchProps) {
  if (batchCount <= 0) return null

  return (
    <div className="picked batch">
      <div className="picked-head">
        <span className="tag exact">待选 {visibleBatch.length}</span>
        <span className="muted">
          {visibleBatch.length ? '点正文里的词可加 / 减' : '挑出的词都已在生词本里'}
        </span>
      </div>
      {visibleBatch.length > 0 && (
        <div className="chips">
          {visibleBatch.map((b) => (
            <button key={b.word} className="chipx" onClick={() => onRemoveWord(b)} title="点击移除">
              {b.word} ×
            </button>
          ))}
        </div>
      )}
      <div className="tasks">
        <button className="primary" onClick={onCommitBatch} disabled={!visibleBatch.length}>
          加入生词本
        </button>
        <button onClick={onCopyBatchPrompt} disabled={!visibleBatch.length}>
          复制查词提示词
        </button>
        <button onClick={onExportBatch} disabled={!visibleBatch.length}>
          导出 CSV
        </button>
        <button onClick={onClearBatch}>清空</button>
      </div>
      {batchCount > visibleBatch.length && (
        <div className="muted hint">
          {visibleBatch.length
            ? `另有 ${batchCount - visibleBatch.length} 个已入库，不再显示（清空可重置）。`
            : `挑出的 ${batchCount} 个词**都已在生词本里**了 —— 去「生词本 / 全部生词」看；待选只显示未入库的词。`}
        </div>
      )}
    </div>
  )
}
