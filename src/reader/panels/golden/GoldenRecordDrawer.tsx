import { useEffect } from 'react'
import GoldenFeedback from './GoldenFeedback'
import { writingRecordLabel, type WritingRecord } from '../../../core/writing'

/** 错因页的「看批改」抽屉；完整反馈复用历史详情的 GoldenFeedback。 */
export default function GoldenRecordDrawer({
  record,
  onClose,
  onOpenHistory,
}: {
  record: WritingRecord | null
  onClose: () => void
  /** 有路由时在历史页打开同一条；没有就隐藏 */
  onOpenHistory?: () => void
}) {
  useEffect(() => {
    if (!record) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [record, onClose])

  if (!record) return null
  return (
    <div
      className="golden-drawer-overlay"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className="golden-drawer" role="dialog" aria-modal="true" aria-label="批改详情">
        <div className="bar golden-plan-bar">
          <b>{writingRecordLabel(record)}</b>
          <span className="muted">{new Date(record.at).toLocaleString()}</span>
          {record.articleTitle && <span className="muted">{record.articleTitle}</span>}
          <button onClick={onClose} title="关闭（Esc）">
            关闭
          </button>
        </div>
        {record.text && <div className="bt-source">{record.text}</div>}
        <GoldenFeedback feedback={record.feedback} model={record.task?.model || record.model} />
        {onOpenHistory && (
          <div className="bar golden-plan-bar">
            <button className="primary" onClick={onOpenHistory}>
              在历史中打开 ↗
            </button>
            <span className="muted">会跳到这条批改的历史详情，可返回错因复盘</span>
          </div>
        )}
      </div>
    </div>
  )
}
