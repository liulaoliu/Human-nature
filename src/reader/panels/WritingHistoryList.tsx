import { useMemo, useState } from 'react'
import {
  historyPage,
  WRITING_HISTORY_PAGE,
  writingRecordKey,
  writingRecordLabel,
  type WritingRecord,
} from '../../core/writing'
import {
  filterWritingHistory,
  WRITING_HISTORY_SOURCE_LABEL,
  WRITING_HISTORY_SOURCES,
  writingHistoryCounts,
  type WritingHistoryFilter,
  type WritingHistoryScope,
  type WritingHistorySource,
} from '../../core/writingHistory'
import GoldenFeedback from './golden/GoldenFeedback'

export interface WritingHistoryListProps {
  history: WritingRecord[]
  articleId: string
  articleTitle?: string
  /** 列表标题；拷打结算页传「造句历史」，仿写面板用默认的「练习历史」。 */
  title?: string
  initialSource?: WritingHistorySource
  initialScope?: WritingHistoryScope
  /**
   * 有它时，点一行就把记录交给外层（仿写面板载入表单）；
   * 没有时在列表内展开详情（拷打结算页没有仿写表单可载入）。
   */
  onLoadRecord?: (rec: WritingRecord) => void
  /** 只清当前筛选范围；不传则隐藏「清空」。 */
  onClear?: (filter: WritingHistoryFilter) => void
}

function keyOf(rec: WritingRecord): string {
  return rec.recordKey || writingRecordKey(rec)
}

/**
 * 仿写 / 拷打造句历史列表：本篇 / 全库 + 来源筛选 + 分页。
 *
 * 筛选与清空规则在 `core/writingHistory`，这里只切状态和渲染；金句课记录
 * 由 D老师小课堂自己的「学习历史」展示，不进入这个列表。
 */
export default function WritingHistoryList({
  history,
  articleId,
  articleTitle,
  title = '练习历史',
  initialSource = 'all',
  initialScope = 'article',
  onLoadRecord,
  onClear,
}: WritingHistoryListProps) {
  const [source, setSource] = useState<WritingHistorySource>(initialSource)
  const [scope, setScope] = useState<WritingHistoryScope>(initialScope)
  const [pickedKey, setPickedKey] = useState<string | null>(null)
  const [shown, setShown] = useState(WRITING_HISTORY_PAGE)

  const filter = useMemo<WritingHistoryFilter>(
    () => ({ source, scope, articleId }),
    [source, scope, articleId],
  )
  const list = useMemo(() => filterWritingHistory(history, filter), [history, filter])
  const articleCounts = useMemo(() => writingHistoryCounts(history, 'article', articleId), [history, articleId])
  const allCounts = useMemo(() => writingHistoryCounts(history, 'all', articleId), [history, articleId])
  const scopeCounts = scope === 'article' ? articleCounts : allCounts

  // 换范围 / 来源就回到第一页；渲染期重置，比 effect 少一帧。
  const pageKey = `${source}|${scope}|${articleId}`
  const [pageFor, setPageFor] = useState(pageKey)
  if (pageFor !== pageKey) {
    setPageFor(pageKey)
    setShown(WRITING_HISTORY_PAGE)
  }
  const page = historyPage(list, shown)
  const picked = pickedKey ? (list.find((rec) => keyOf(rec) === pickedKey) ?? null) : null

  const changeSource = (next: WritingHistorySource) => {
    setSource(next)
    setPickedKey(null)
  }
  const changeScope = (next: WritingHistoryScope) => {
    setScope(next)
    setPickedKey(null)
  }
  const clearCurrent = () => {
    onClear?.(filter)
    setPickedKey(null)
  }

  if (picked) {
    return (
      <div className="write-history write-history-detail">
        <div className="bar write-history-bar">
          <button onClick={() => setPickedKey(null)}>← 历史列表</button>
          <b>{writingRecordLabel(picked)}</b>
          <span className="muted">{new Date(picked.at).toLocaleString()}</span>
          {picked.articleTitle && <span className="muted">{picked.articleTitle}</span>}
        </div>
        {picked.text && <div className="bt-source">{picked.text}</div>}
        <GoldenFeedback feedback={picked.feedback} model={picked.task?.model || picked.model} />
      </div>
    )
  }

  return (
    <div className="write-history">
      <div className="bar write-history-bar">
        <span className="muted">
          {title}（{list.length}）
        </span>
        <button className={scope === 'article' ? 'primary' : ''} onClick={() => changeScope('article')}>
          本篇（{articleCounts[source]}）
        </button>
        <button className={scope === 'all' ? 'primary' : ''} onClick={() => changeScope('all')}>
          全库（{allCounts[source]}）
        </button>
        <select
          value={source}
          onChange={(e) => changeSource(e.target.value as WritingHistorySource)}
          title="按来源筛选"
          aria-label="按来源筛选"
        >
          {WRITING_HISTORY_SOURCES.map((s) => (
            <option key={s} value={s}>
              {WRITING_HISTORY_SOURCE_LABEL[s]}（{scopeCounts[s]}）
            </option>
          ))}
        </select>
        {onClear && list.length > 0 && (
          <button className="danger" onClick={clearCurrent} title="只清空当前筛选范围内的记录">
            清空
          </button>
        )}
      </div>
      <div className="muted write-history-scope">
        {scope === 'article' ? `本篇：${articleTitle || articleId || '当前文章'}` : '全库：所有文章'}
        {' · '}
        {WRITING_HISTORY_SOURCE_LABEL[source]}
      </div>

      {list.length ? (
        <>
          {page.rows.map((rec) => (
            <button
              key={keyOf(rec)}
              className="write-hist-row"
              onClick={() => {
                if (onLoadRecord) onLoadRecord(rec)
                else setPickedKey(keyOf(rec))
              }}
            >
              <span className="muted">{new Date(rec.at).toLocaleString()}</span>
              <span className="ellipsis">
                {writingRecordLabel(rec)}
                {rec.model ? ` · ${rec.model}` : ''}
              </span>
              {scope === 'all' && (
                <span className="muted ellipsis">{rec.articleTitle || rec.articleId}</span>
              )}
              <b>{rec.feedback.max > 0 ? `${rec.feedback.total}/${rec.feedback.max}` : '—'}</b>
            </button>
          ))}
          {page.rest > 0 && (
            <button
              className="write-hist-row write-hist-more"
              onClick={() => setShown(page.next)}
              title="记录一条都没删，只是先渲染最近这些；点这里继续往前看"
            >
              <span className="muted">显示更多（还有 {page.rest} 条）</span>
            </button>
          )}
        </>
      ) : (
        <div className="muted write-history-empty">
          {scope === 'article'
            ? `本篇还没有${source === 'all' ? '练习' : WRITING_HISTORY_SOURCE_LABEL[source]}记录；批改一次就会存下来。`
            : `还没有${source === 'all' ? '练习' : WRITING_HISTORY_SOURCE_LABEL[source]}记录；批改一次就会存下来。`}
          {scope === 'article' && allCounts[source] > 0 && (
            <button onClick={() => changeScope('all')}>全库有 {allCounts[source]} 条</button>
          )}
        </div>
      )}
    </div>
  )
}
