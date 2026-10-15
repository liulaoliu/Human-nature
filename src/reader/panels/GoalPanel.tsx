import { goalPct, goalReached, type ReadDone } from '../../core/goals'

export interface GoalPanelProps {
  onClose: () => void
  /** 今天的日期键 YYYY-MM-DD */
  todayKey: string
  /** 今天已经读完的篇目 */
  done: ReadDone[]
  /** 今日读文目标（篇；0 = 不设目标） */
  goal: number
  onGoalChange: (n: number) => void
  /** 自由备忘 */
  memo: string
  onMemoChange: (s: string) => void
  /** 当前文章标题 */
  articleTitle: string
  /** 当前这篇今天是否已算「读完」 */
  articleDone: boolean
  /** 把当前这篇标记为读完 */
  onMarkDone: () => void
  /** 撤销某篇的「读完」 */
  onUndo: (articleId: string) => void
}

/**
 * 目标备忘：今天读了几篇（可设目标、自动进度）+ 一个自由备忘框。
 *
 * 「读完」的标准：**速读把这篇过完**（自动记），或在下面手动「标记读完」；同一天同一篇只算一次。
 */
export default function GoalPanel({
  onClose,
  todayKey,
  done,
  goal,
  onGoalChange,
  memo,
  onMemoChange,
  articleTitle,
  articleDone,
  onMarkDone,
  onUndo,
}: GoalPanelProps) {
  const pct = goalPct(done.length, goal)
  const reached = goalReached(done.length, goal)

  return (
    <div className="plan-overlay" onClick={onClose}>
      <div className="plan-panel goal-panel" onClick={(e) => e.stopPropagation()}>
        <div className="bar plan-head">
          <b>📌 目标备忘</b>
          <span className={'ilevel ilevel-' + (reached ? 3 : pct >= 50 ? 1 : 0)}>
            {goal > 0 ? `${done.length}/${goal} 篇` : `${done.length} 篇`}
            {reached ? ' ✅' : ''}
          </span>
          <span className="muted">{todayKey}</span>
          <button onClick={onClose}>关闭</button>
        </div>

        <div className="gsec">
          <div className="grow">
            <b>今日读文</b>
            <span className="muted">读完 {done.length} 篇</span>
            <label className="check-inline" title="每天读几篇（自动按本篇数算进度）">
              目标
              <select value={String(goal)} onChange={(e) => onGoalChange(Number(e.target.value))}>
                <option value="0">不设目标</option>
                <option value="1">1 篇</option>
                <option value="2">2 篇</option>
                <option value="3">3 篇</option>
                <option value="5">5 篇</option>
              </select>
            </label>
          </div>
          <div className="ibar">
            <i style={{ width: pct + '%' }} />
          </div>
          <div className="muted gtip">
            「读完」的标准：**速读把这篇过完**（自动记一次）；也可以在这里手动标记。同一天同一篇只算一次。
          </div>
          <div className="grow">
            <button className={articleDone ? '' : 'primary'} onClick={onMarkDone} disabled={articleDone}>
              {articleDone ? '当前篇已算读完 ✓' : `把《${articleTitle || '当前篇'}》标记读完`}
            </button>
          </div>
          {done.length > 0 ? (
            <div className="glist">
              {done.map((d) => (
                <div className="gitem" key={d.articleId}>
                  <span className="gitem-time muted">{d.at.slice(11, 16)}</span>
                  <span className="gitem-title ellipsis" title={d.title}>
                    {d.title || d.articleId}
                  </span>
                  <button onClick={() => onUndo(d.articleId)} title="撤销这篇的「读完」">
                    ×
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <div className="muted">今天还没读完文章</div>
          )}
        </div>

        <div className="gsec">
          <b>备忘</b>
          <textarea
            className="gmemo"
            rows={5}
            value={memo}
            placeholder="想记的随手写在这（比如「这周把 Bello 那篇精读完」「明天补 X 篇」）…"
            onChange={(e) => onMemoChange(e.target.value)}
          />
        </div>
      </div>
    </div>
  )
}
