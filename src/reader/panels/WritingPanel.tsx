import { useState } from 'react'
import type { ImitationTask, WritingFeedback, WritingRecord } from '../../core/writing'

export interface WritingPanelProps {
  model: string
  text: string
  task: ImitationTask | null
  feedback: WritingFeedback | null
  history: WritingRecord[]
  onClose: () => void
  onGenerateTask: () => void
  onFeedback: () => void
  onModelChange: (value: string) => void
  onTextChange: (value: string) => void
  onClearHistory: () => void
  onLoadRecord: (rec: WritingRecord) => void
}

/** 仿写训练：范句 + 任务 + 我的仿写 + AI 批改 + 历史。历史展开是本地 UI 状态。 */
export default function WritingPanel({
  model,
  text,
  task,
  feedback,
  history,
  onClose,
  onGenerateTask,
  onFeedback,
  onModelChange,
  onTextChange,
  onClearHistory,
  onLoadRecord,
}: WritingPanelProps) {
  const [historyOpen, setHistoryOpen] = useState(false)

  return (
    <div className="study writing">
      <div className="bar study-bar">
        <button onClick={onClose}>结束（Esc）</button>
        <span className="muted">仿写训练</span>
        <button onClick={onGenerateTask}>① 生成任务</button>
        <button className="primary" onClick={onFeedback} disabled={!task || !text.trim()}>
          ② 批改
        </button>
        <button onClick={() => setHistoryOpen((v) => !v)}>历史（{history.length}）</button>
      </div>

      <div className="write-block">
        <div className="muted">范句（可改）</div>
        <textarea
          className="study-input write-model"
          value={model}
          onChange={(e) => onModelChange(e.target.value)}
          rows={3}
        />
        {task && (
          <div className="write-task">
            <div>
              <b>任务：</b>
              {task.task}
            </div>
            {task.structure && <div className="muted">结构：{task.structure}</div>}
            {task.mustUse.length > 0 && <div className="muted">必须用上：{task.mustUse.join('、')}</div>}
            {task.rubric.length > 0 && (
              <div className="muted">评分：{task.rubric.map((r) => `${r.dimension}(${r.weight})`).join(' · ')}</div>
            )}
          </div>
        )}
        <div className="muted">我的仿写</div>
        <textarea
          className="study-input write-text"
          placeholder="在这里写…写完点「② 批改」"
          value={text}
          onChange={(e) => onTextChange(e.target.value)}
          rows={6}
        />
      </div>

      {feedback && (
        <div className="write-feedback">
          <div className="muted">
            得分：{feedback.total}/{feedback.max}
          </div>
          {feedback.scores.map((s) => (
            <div key={s.dimension}>
              {s.dimension}：{s.score}/{s.max}
              {s.comment ? ` — ${s.comment}` : ''}
            </div>
          ))}
          {feedback.issues.length > 0 && (
            <ul className="write-issues">
              {feedback.issues.map((is, i) => (
                <li key={i}>
                  <span className="bad">{is.original}</span> → <span className="ok">{is.suggestion}</span>
                  {is.reason ? `（${is.reason}）` : ''}
                </li>
              ))}
            </ul>
          )}
          {feedback.polished && (
            <div className="write-polished">
              <b>改写示范：</b>
              {feedback.polished}
            </div>
          )}
          {feedback.summary && <div className="muted">{feedback.summary}</div>}
        </div>
      )}

      {historyOpen && (
        <div className="write-history">
          <div className="bar">
            <span className="muted">练习历史（{history.length}）</span>
            {history.length > 0 && (
              <button className="danger" onClick={onClearHistory}>
                清空
              </button>
            )}
          </div>
          {history.length ? (
            history.map((rec, i) => (
              <button
                key={i}
                className="write-hist-row"
                onClick={() => {
                  onLoadRecord(rec)
                  setHistoryOpen(false)
                }}
              >
                <span className="muted">{new Date(rec.at).toLocaleString()}</span>
                <span className="ellipsis"> {rec.model}</span>
                <b>
                  {rec.feedback.total}/{rec.feedback.max}
                </b>
              </button>
            ))
          ) : (
            <div className="muted">还没有记录；批改一次就会存下来。</div>
          )}
        </div>
      )}
    </div>
  )
}
