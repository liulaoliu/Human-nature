import { useMemo, useState } from 'react'
import {
  historyPage,
  WRITING_HISTORY_PAGE,
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
import WritingHoverCard, { hoverDataFromRecord, recordKeyOf } from './golden/WritingHoverCard'

export interface WritingHistoryListProps {
  history: WritingRecord[]
  articleId: string
  articleTitle?: string
  /** 列表标题；拷打结算页传「造句历史」，仿写面板用默认的「练习历史」。 */
  title?: string
  initialSource?: WritingHistorySource
  initialScope?: WritingHistoryScope
  /**
   * 有它时，点一行就把记录交给外层（不展开详情）。**旧行为**，只在没有
   * `onOpenRecord` 时才用；仿写面板已改为「点开只读详情，再手动载入」。
   */
  onLoadRecord?: (rec: WritingRecord) => void
  /** 只清当前筛选范围；不传则隐藏「清空」。 */
  onClear?: (filter: WritingHistoryFilter) => void
  /**
   * 受控范围：给了它（和 `onScopeChange`）就由外层决定本篇/全库。
   * 仿写面板用 URL 当事实来源，刷新/分享都能回到同一个筛选。
   */
  scope?: WritingHistoryScope
  onScopeChange?: (scope: WritingHistoryScope) => void
  /**
   * URL 指定的记录键（`WritingRecord.recordKey`，不是下标）。
   * 给了它就渲染那一条的详情，并按它在列表里的位置算「上一条/下一条」。
   */
  focusRecordKey?: string
  /** 有它时点行、翻页都交给外层写 URL；没有则在组件内切换。`replace` 用于详情内翻页。 */
  onOpenRecord?: (recordKey: string, scope: WritingHistoryScope, replace?: boolean) => void
  /** 详情 → 历史列表；有路由时由外层 replace URL。 */
  onCloseDetail?: () => void
  /** 详情里的「载入到表单继续改」：不点它，翻历史不会冲掉正在写的草稿。 */
  onResumeRecord?: (rec: WritingRecord) => void
  /** 列表顶部返回上层（回仿写 / 回课程页）；不传则不显示。 */
  onBack?: () => void
  backLabel?: string
  /**
   * 紧凑模式（嵌在精读工作流里用）：只留范围 / 来源 / 行，不显示标题和「清空」，
   * 一次少渲染几条。判定与分页仍走同一套 `core/writingHistory` + `historyPage`。
   */
  compact?: boolean
  /** 一页渲染多少条（默认 `WRITING_HISTORY_PAGE`）；紧凑模式传小一点。 */
  pageSize?: number
}

/** 悬浮时给一行摘要（原生 title）：够看出是哪次、写了什么、AI 怎么评。 */
function hoverSummary(rec: WritingRecord, index: number): string {
  return [
    `第 ${index + 1} 次 · ${writingRecordLabel(rec)}`,
    rec.articleTitle || rec.articleId,
    rec.text ? `作答：${rec.text}` : '',
    rec.feedback.max > 0 ? `评分：${rec.feedback.total}/${rec.feedback.max}` : '',
    rec.feedback.summary ? `总评：${rec.feedback.summary}` : '',
  ]
    .filter(Boolean)
    .join('\n')
    .slice(0, 500)
}

/**
 * 仿写 / 拷打造句历史：本篇 / 全库 + 来源筛选 + 分页 + 悬浮摘要 + 详情翻页。
 *
 * 口径（哪些记录能看、怎么按来源分组、清空清哪一段）全在 `core/writingHistory`，
 * 这里只切状态和渲染；金句课记录由 D老师小课堂自己的「学习历史」展示，不进入这个列表。
 *
 * 两种用法：
 *   - **组件内**（拷打结算页）：不传 `onOpenRecord`，点行在列表里展开详情，范围是本地 state；
 *   - **URL 驱动**（仿写面板）：传 `focusRecordKey` / `onOpenRecord` / `onCloseDetail`，
 *     点行与翻页都写地址，刷新 / 分享 / 返回键都能落回同一条记录。
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
  scope: controlledScope,
  onScopeChange,
  focusRecordKey,
  onOpenRecord,
  onCloseDetail,
  onResumeRecord,
  onBack,
  backLabel = '回仿写',
  compact = false,
  pageSize = WRITING_HISTORY_PAGE,
}: WritingHistoryListProps) {
  const [localSource, setLocalSource] = useState<WritingHistorySource>(initialSource)
  const [localScope, setLocalScope] = useState<WritingHistoryScope>(initialScope)
  const [localPickedIndex, setLocalPickedIndex] = useState<number | null>(null)
  const [shown, setShown] = useState(pageSize)

  const source = localSource
  const scope = controlledScope ?? localScope

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
    setShown(pageSize)
  }
  const page = historyPage(list, shown, pageSize)

  // URL 指定的那一条优先；找不到（已归档 / 不在当前范围）就退到组件内选中的那一条。
  const focusIndex = focusRecordKey ? list.findIndex((rec) => recordKeyOf(rec) === focusRecordKey) : -1
  const effectiveIndex = focusIndex >= 0 ? focusIndex : localPickedIndex
  const picked = effectiveIndex !== null && effectiveIndex >= 0 ? (list[effectiveIndex] ?? null) : null
  const missingFocus = !!focusRecordKey && focusIndex < 0

  const changeSource = (next: WritingHistorySource) => {
    setLocalSource(next)
    setLocalPickedIndex(null)
  }
  const changeScope = (next: WritingHistoryScope) => {
    setLocalScope(next)
    setLocalPickedIndex(null)
    onScopeChange?.(next)
  }
  const openRecord = (rec: WritingRecord, index: number) => {
    if (onOpenRecord) onOpenRecord(recordKeyOf(rec), scope)
    else if (onLoadRecord) onLoadRecord(rec)
    else setLocalPickedIndex(index)
  }
  const closeDetail = () => {
    if (onCloseDetail) onCloseDetail()
    else setLocalPickedIndex(null)
  }
  const step = (delta: number) => {
    if (effectiveIndex === null || effectiveIndex < 0) return
    const next = Math.max(0, Math.min(list.length - 1, effectiveIndex + delta))
    if (next === effectiveIndex) return
    const rec = list[next]
    if (!rec) return
    if (onOpenRecord) onOpenRecord(recordKeyOf(rec), scope, true)
    else setLocalPickedIndex(next)
  }
  const clearCurrent = () => {
    onClear?.(filter)
    setLocalPickedIndex(null)
  }

  if (picked) {
    return (
      <div className="write-history write-history-detail">
        <div className="bar write-history-bar">
          <button onClick={closeDetail}>← 历史列表</button>
          <button onClick={() => step(-1)} disabled={(effectiveIndex ?? 0) <= 0} title="看更早一条">
            ◀ 上一条
          </button>
          <span className="muted">
            第 {(effectiveIndex ?? 0) + 1}/{list.length} 条 · {new Date(picked.at).toLocaleString()}
          </span>
          <button
            onClick={() => step(1)}
            disabled={(effectiveIndex ?? 0) >= list.length - 1}
            title="看更新一条"
          >
            下一条 ▶
          </button>
          <b>{writingRecordLabel(picked)}</b>
          {picked.articleTitle && <span className="muted">{picked.articleTitle}</span>}
          {onResumeRecord && (
            <button className="primary" onClick={() => onResumeRecord(picked)} title="把这条载入仿写表单继续改（会替换表单里的范句和作答）">
              载入到表单继续改
            </button>
          )}
          {onBack && <button onClick={onBack}>← {backLabel}</button>}
        </div>
        {picked.text && <div className="bt-source">{picked.text}</div>}
        <GoldenFeedback feedback={picked.feedback} model={picked.task?.model || picked.model} />
      </div>
    )
  }

  return (
    <div className={'write-history' + (compact ? ' write-history-compact' : '')}>
      <div className="bar write-history-bar">
        {onBack && <button onClick={onBack}>← {backLabel}</button>}
        {!compact && (
          <span className="muted">
            {title}（{list.length}）
          </span>
        )}
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
        {onClear && !compact && list.length > 0 && (
          <button className="danger" onClick={clearCurrent} title="只清空当前筛选范围内的记录">
            清空
          </button>
        )}
      </div>
      {!compact && (
        <div className="muted write-history-scope">
          {scope === 'article' ? `本篇：${articleTitle || articleId || '当前文章'}` : '全库：所有文章'}
          {' · '}
          {WRITING_HISTORY_SOURCE_LABEL[source]}
        </div>
      )}

      {missingFocus && (
        <div className="write-history-missing">这条记录已归档或不在当前范围；可以换个范围再看。</div>
      )}

      {list.length ? (
        <>
          {page.rows.map((rec, i) => (
            <WritingHoverCard key={recordKeyOf(rec)} data={hoverDataFromRecord(rec, i)}>
              <button
                className="write-hist-row"
                onClick={() => openRecord(rec, i)}
                aria-label={hoverSummary(rec, i)}
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
            </WritingHoverCard>
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
