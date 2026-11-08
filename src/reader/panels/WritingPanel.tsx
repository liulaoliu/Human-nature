import type { ImitationTask, WritingFeedback, WritingRecord } from '../../core/writing'
import { writingHistoryCounts, type WritingHistoryFilter, type WritingHistoryScope } from '../../core/writingHistory'
import type { WriteRouteState } from '../route'
import WritingHistoryList from './WritingHistoryList'

/** 仿写面板的 URL 接线：`route.ts` 解析出来的子视图 + 写回地址。 */
export interface WritingPanelActions {
  route?: WriteRouteState
  onNavigate?: (state: WriteRouteState, opts?: { replace?: boolean }) => void
  /**
   * 从精读工作流的「练习历史」点一条：打开仿写并直接定位到那条记录。
   * 和 `onNavigate` 分开，是因为它得带 `back=intensive`——否则关掉仿写会掉回文章主界面，
   * 而不是回到用户点历史之前那个精读面板。
   */
  onOpenHistory?: (recordKey: string, scope: 'article' | 'all') => void
}

export interface WritingPanelProps {
  model: string
  text: string
  task: ImitationTask | null
  feedback: WritingFeedback | null
  history: WritingRecord[]
  /** 当前文章；历史筛选的「本篇」按它归属。 */
  articleId: string
  articleTitle?: string
  onClose: () => void
  onGenerateTask: () => void
  onFeedback: () => void
  onModelChange: (value: string) => void
  onTextChange: (value: string) => void
  /** 只清当前筛选范围（来源 + 篇/全库），金句课记录不在这里清。 */
  onClearHistory: (filter: WritingHistoryFilter) => void
  /** 把一条历史载入表单（只在详情里点「载入到表单继续改」时发生）。 */
  onLoadRecord: (rec: WritingRecord) => void
  /** 当前 `/p/write` query；没有就 undefined（没有路由时不改行为）。 */
  writeRoute?: WriteRouteState
  /** 写 `/p/write` 子视图 / 记录定位；replace 用于详情翻页与关详情。 */
  onNavigateWrite?: (state: WriteRouteState, opts?: { replace?: boolean }) => void
  /** 关掉仿写后回哪个布尔面板（从精读的练习历史点进来时是 `intensive`）。 */
  backLabel?: string
}

/**
 * 仿写训练：范句 + 任务 + 我的仿写 + AI 批改 + 历史。
 *
 * 历史不再是「组件里的开关」：列表与详情都由 `/p/write?wv=history&wr=…&ws=…` 决定，
 * 这样刷新 / 分享 / 返回键都能落回同一条记录，点「结束」也不会从某条详情直接掉回文章主界面。
 * 视图 → URL 与 URL → 视图的两条线都交给路由（和 `GoldenPanel` 同一套语义），
 * 面板本身不写 query。
 */
export default function WritingPanel({
  model,
  text,
  task,
  feedback,
  history,
  articleId,
  articleTitle,
  onClose,
  onGenerateTask,
  onFeedback,
  onModelChange,
  onTextChange,
  onClearHistory,
  onLoadRecord,
  writeRoute,
  onNavigateWrite,
  backLabel = '回仿写',
}: WritingPanelProps) {
  // 金句课的记录由小课堂自己回看；这里默认只看本篇的普通仿写 / 工棚 / 拷打造句。
  const historyCount = writingHistoryCounts(history, 'article', articleId).all
  const historyOpen = writeRoute?.view === 'history'
  const scope: WritingHistoryScope = writeRoute?.scope ?? 'article'
  const routed = !!onNavigateWrite

  const openHistory = () => {
    if (routed) onNavigateWrite?.({ view: 'history', scope })
  }
  const closeHistory = () => {
    if (routed) onNavigateWrite?.({}, { replace: true })
  }
  const openRecord = (recordKey: string, nextScope: WritingHistoryScope, replace?: boolean) => {
    if (routed) onNavigateWrite?.({ view: 'history', recordKey, scope: nextScope }, { replace: !!replace })
  }
  const closeDetail = () => {
    if (routed) onNavigateWrite?.({ view: 'history', scope }, { replace: true })
  }
  const changeScope = (next: WritingHistoryScope) => {
    if (routed) onNavigateWrite?.({ view: 'history', scope: next }, { replace: true })
  }

  if (historyOpen) {
    return (
      <div className="study writing">
        <div className="bar study-bar">
          <button onClick={closeHistory}>← {backLabel}</button>
          <span className="muted">仿写历史</span>
          <button onClick={onClose} title="退出仿写训练（Esc）；从精读进来会回到精读面板">
            结束（Esc）
          </button>
        </div>
        <WritingHistoryList
          history={history}
          articleId={articleId}
          {...(articleTitle ? { articleTitle } : {})}
          scope={scope}
          {...(routed ? { onScopeChange: changeScope } : {})}
          {...(writeRoute?.recordKey ? { focusRecordKey: writeRoute.recordKey } : {})}
          {...(routed ? { onOpenRecord: openRecord, onCloseDetail: closeDetail } : {})}
          onResumeRecord={(rec) => {
            onLoadRecord(rec)
            closeHistory()
          }}
          onClear={onClearHistory}
        />
      </div>
    )
  }

  return (
    <div className="study writing">
      <div className="bar study-bar">
        <button onClick={onClose}>结束（Esc）</button>
        <span className="muted">仿写训练</span>
        <button onClick={onGenerateTask}>① 生成任务</button>
        <button className="primary" onClick={onFeedback} disabled={!task || !text.trim()}>
          ② 批改
        </button>
        <button onClick={openHistory} title="看历史批改记录：悬浮看摘要，点开可上一条/下一条翻">
          历史（{historyCount}）
        </button>
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
    </div>
  )
}
