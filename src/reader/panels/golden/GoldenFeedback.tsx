import type { WritingFeedback } from '../../../core/writing'

/** 仿写批改的统一展示；整课考试和单句仿写共用。 */
export default function GoldenFeedback({
  feedback,
  model,
}: {
  feedback: WritingFeedback
  model?: string
}) {
  return (
    <div className="write-feedback">
      <div className="muted">得分：{feedback.total}/{feedback.max}</div>
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
      {model && <div className="golden-note">范句：{model}</div>}
    </div>
  )
}
