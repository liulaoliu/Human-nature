import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import type { ProductionMode } from '../../core/production'
import {
  filterProductionHistory,
  groupProductionAttempts,
  productionHistoryMarkdown,
  productionReviewCounts,
  productionStats,
  productionTargetKey,
  productionTaskOf,
  productionRecordHits,
  productionTopErrors,
  productionTrend,
  type ProductionProgress,
} from '../../core/productionHistory'
import type { WritingRecord } from '../../core/writing'
import { PRODUCTION_MODE_LABEL } from '../../core/production'

export interface ProductionHistoryPanelProps {
  records: WritingRecord[]
  progress: readonly ProductionProgress[]
  articleIdentity: string
  articleTitle: string
  onBack: () => void
}

function downloadText(name: string, text: string) {
  const blob = new Blob([text], { type: 'text/markdown;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  URL.revokeObjectURL(url)
}

/** 工棚历史：筛选 / 两稿对比 / 目标块趋势 / Markdown 导出。 */
export default function ProductionHistoryPanel({
  records,
  progress,
  articleIdentity,
  articleTitle,
  onBack,
}: ProductionHistoryPanelProps) {
  const [params, setParams] = useSearchParams()
  const [selected, setSelected] = useState<string | null>(null)
  const [limit, setLimit] = useState(40)
  const rawMode = params.get('pm')
  const mode: ProductionMode | 'all' =
    rawMode === 'full' || rawMode === 'skim' || rawMode === 'yogurt' ? rawMode : 'all'
  const scope: 'all' | 'article' = params.get('pa') === 'all' ? 'all' : 'article'
  const topic = params.get('pt') ?? ''
  const targetKey = params.get('ptk')
  const setParam = (key: string, value: string) => {
    const next = new URLSearchParams(params)
    if (value) next.set(key, value)
    else next.delete(key)
    setParams(next, { replace: true })
  }
  const setScope = (value: 'all' | 'article') => setParam('pa', value === 'all' ? 'all' : '')
  const setMode = (value: ProductionMode | 'all') => setParam('pm', value === 'all' ? '' : value)
  const setTopic = (value: string) => setParam('pt', value)
  const setTargetKey = (value: string | null) => setParam('ptk', value ?? '')

  useEffect(() => {
    setLimit(40)
    setSelected(null)
  }, [scope, mode, topic, articleIdentity])

  const filtered = useMemo(
    () =>
      filterProductionHistory(records, {
        ...(scope === 'article' && articleIdentity ? { articleId: articleIdentity } : {}),
        mode,
        ...(topic.trim() ? { topic } : {}),
      }),
    [records, scope, articleIdentity, mode, topic],
  )
  const filteredStats = useMemo(() => productionStats(filtered), [filtered])
  // 趋势 / 高频错因只看最近 1000 条；历史列表另有分页，避免老记录拖慢首屏。
  const recent = useMemo(() => filtered.slice(0, 1000), [filtered])
  const trend = useMemo(() => productionTrend(recent, new Date().toISOString()), [recent])
  const topErrors = useMemo(() => productionTopErrors(recent), [recent])
  const groups = useMemo(() => groupProductionAttempts(filtered), [filtered])
  const shownGroups = groups.slice(0, limit)
  const group = groups.find((g) => g.key === selected) ?? groups[0] ?? null
  const counts = productionReviewCounts(progress, new Date().toISOString())
  const targetProgress = targetKey ? progress.find((p) => p.key === targetKey) : undefined
  const targetRows = useMemo(() => {
    if (!targetKey) return []
    return filtered.flatMap((rec) =>
      productionRecordHits(rec)
        .filter((h) => productionTargetKey(h.kind, h.text) === targetKey)
        .map((h) => ({ rec, hit: h })),
    )
  }, [filtered, targetKey])

  return (
    <div className="production-body production-history">
      <div className="bar">
        <button onClick={onBack}>← 返回工棚</button>
        <b>产出历史</b>
        <span className="muted">{articleTitle || '全部文章'}</span>
      </div>

      <div className="production-stats">
        <span>产出 {filteredStats.attempts} 次</span>
        <span>组 {filteredStats.sessions}</span>
        <span>重写 {filteredStats.rewrites} 次</span>
        <span>目标块命中 {Math.round(filteredStats.hitRate * 100)}%</span>
        <span>平均分 {Math.round(filteredStats.avgScore)}</span>
        <span>到期 {counts.due}</span>
        <span>薄弱 {counts.weak}</span>
      </div>

      <div className="production-stats">
        <span>近 7 天目标块命中 {trend.recentAttempts ? `${Math.round(trend.recentHitRate * 100)}%` : '—'}</span>
        <span>重写平均提分 {trend.rewriteGain > 0 ? `+${Math.round(trend.rewriteGain)}` : Math.round(trend.rewriteGain)}</span>
        {topErrors.map((e) => (
          <span key={e.key} title={e.sample}>
            常错 {e.rule} ×{e.count}
          </span>
        ))}
      </div>

      <div className="bar production-history-filters">
        <select
          aria-label="历史文章范围"
          value={scope}
          onChange={(e) => setScope(e.target.value as 'all' | 'article')}
        >
          <option value="article">本篇</option>
          <option value="all">全部</option>
        </select>
        <select
          aria-label="历史模式"
          value={mode}
          onChange={(e) => setMode(e.target.value as ProductionMode | 'all')}
        >
          <option value="all">全部模式</option>
          <option value="full">全脂</option>
          <option value="skim">脱脂奶</option>
          <option value="yogurt">风味酸奶</option>
        </select>
        <input
          aria-label="历史主题搜索"
          value={topic}
          onChange={(e) => setTopic(e.target.value)}
          placeholder="搜主题 / 题目"
        />
        <button
          onClick={() => downloadText(`奶牛工棚-${Date.now()}.md`, productionHistoryMarkdown(filtered))}
          disabled={!filtered.length}
        >
          导出 Markdown
        </button>
      </div>

      {groups.length === 0 ? (
        <div className="muted">还没有记录。先完成一组产出，就会出现在这里。</div>
      ) : (
        <div className="production-history-layout">
          <div className="production-history-list">
            {shownGroups.map((g) => {
              const last = g.records[g.records.length - 1]
              const task = productionTaskOf(last)
              return (
                <button
                  key={g.key}
                  className={'production-history-item' + (group?.key === g.key ? ' active' : '')}
                  onClick={() => setSelected(g.key)}
                >
                  <b>{task?.task || g.title}</b>
                  <span className="muted">
                    {task?.mode ? PRODUCTION_MODE_LABEL[task.mode] : '产出'} · {g.records.length} 稿 ·{' '}
                    {g.legacy ? '旧记录 · ' : ''}
                    {task?.skipped ? '跳过' : `${last?.feedback.total}/${last?.feedback.max}`}
                  </span>
                </button>
              )
            })}
            {groups.length > limit && (
              <button onClick={() => setLimit((n) => n + 40)}>
                显示更多（还剩 {groups.length - limit} 组）
              </button>
            )}
          </div>

          {group && (
            <div className="production-history-detail">
              {group.records.map((rec) => {
                const task = productionTaskOf(rec)
                const hits = productionRecordHits(rec)
                return (
                  <div className="production-history-attempt" key={rec.recordKey ?? `${rec.at}-${rec.text}`}>
                    <div className="bar">
                      <b>第 {task?.round ?? 1} 稿</b>
                      <span className="muted">
                        {task?.skipped ? '跳过（未提交）' : `${rec.feedback.total}/${rec.feedback.max}`}
                      </span>
                    </div>
                    {task?.reference && (
                      <div className="production-reference">
                        <b>参考译文：</b>
                        {task.reference}
                      </div>
                    )}
                    <div className="production-history-text">{rec.text}</div>
                    {hits.length > 0 && (
                      <div className="production-hits">
                        {hits.map((h) => (
                          <button
                            key={h.id}
                            className={'production-hit ' + (h.used ? 'ok' : 'bad')}
                            onClick={() => setTargetKey(productionTargetKey(h.kind, h.text))}
                            title="看这个目标块的历次命中"
                          >
                            {h.text}：{h.used ? '用上了' : '没用上'}
                          </button>
                        ))}
                      </div>
                    )}
                    {rec.feedback.summary && <div className="muted">总评：{rec.feedback.summary}</div>}
                  </div>
                )
              })}
              {targetKey && (
                <div className="production-target-detail">
                  <div className="bar">
                    <b>目标块：{targetRows[0]?.hit.text ?? targetKey}</b>
                    <button onClick={() => setTargetKey(null)}>关闭</button>
                  </div>
                  {targetProgress ? (
                    <div className="muted">
                      练过 {targetProgress.attempts} 次 · 命中 {targetProgress.hits} 次 · 连对{' '}
                      {targetProgress.streak} · 到期 {new Date(targetProgress.dueAt).toLocaleDateString()}
                    </div>
                  ) : (
                    <div className="muted">还没有这个目标块的进度记录。</div>
                  )}
                  {targetRows.length === 0 ? (
                    <div className="muted">当前筛选里没有它的产出。</div>
                  ) : (
                    <div className="production-target-rows">
                      {targetRows.map(({ rec, hit }) => (
                        <div key={`${rec.recordKey}-${hit.id}`} className={hit.used ? 'ok' : 'bad'}>
                          {new Date(rec.at).toLocaleDateString()} · {hit.used ? '用上了' : '没用上'} ·{' '}
                          {rec.text.slice(0, 80)}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
