import { useState } from 'react'
import GoldenFeedback from './GoldenFeedback'
import type { WritingRecord } from '../../../core/writing'

const SOURCE_LABEL: Record<NonNullable<WritingRecord['source']>, string> = {
  writing: '仿写',
  goldenSentence: '单句仿写',
  goldenExam: '整课考试',
}

/**
 * D老师小课堂的「学习历史」：本科做过的单句仿写 / 整课考试，以及当时的 AI 批改。
 *
 * 批改原文只存在 `writingHistory.feedback` 里，平时只在交卷瞬间显示；
 * 这里按时间倒序摊开，点开就是当时的完整批改（分数/逐条问题/润色/总评）。
 * 纯展示：筛选在 `useGoldenFeature`（`isGoldenWritingRecord` + 本篇 id），这里不重算规则。
 */
export default function GoldenHistoryView({
  rows,
  onBack,
}: {
  rows: WritingRecord[]
  onBack: () => void
}) {
  const [picked, setPicked] = useState<WritingRecord | null>(null)
  const list = [...rows].sort((a, b) => b.at.localeCompare(a.at))

  if (picked) {
    return (
      <div className="golden-body">
        <div className="bar golden-plan-bar">
          <button onClick={() => setPicked(null)}>← 历史列表</button>
          <b>{SOURCE_LABEL[picked.source ?? 'writing']}</b>
          <span className="muted">{new Date(picked.at).toLocaleString()}</span>
          <button onClick={onBack}>课程页</button>
        </div>
        {picked.text && <div className="bt-source">{picked.text}</div>}
        <GoldenFeedback feedback={picked.feedback} model={picked.task?.model || picked.model} />
      </div>
    )
  }

  return (
    <div className="golden-body">
      <div className="bar golden-plan-bar">
        <button onClick={onBack}>← 课程页</button>
        <b>本科学习历史</b>
        <span className="muted">{list.length} 条批改</span>
      </div>
      {list.length ? (
        <div className="bt-history-list">
          {list.map((rec, i) => (
            <button
              key={`${rec.at}-${i}`}
              className="bt-history-row"
              onClick={() => setPicked(rec)}
              title="点开看当时的完整批改"
            >
              <span className="muted">{new Date(rec.at).toLocaleString()}</span>
              <span className="ellipsis">{SOURCE_LABEL[rec.source ?? 'writing']}</span>
              <span className="muted ellipsis">{rec.task?.task || rec.model}</span>
              <b>{rec.feedback.max > 0 ? `${rec.feedback.total}/${rec.feedback.max}` : '—'}</b>
            </button>
          ))}
        </div>
      ) : (
        <div className="muted">还没有记录：做完一句仿写或整课考试，批改会自动留在这里。</div>
      )}
    </div>
  )
}
