import { useMemo, useState } from 'react'
import type { ProductionMode } from '../../core/production'
import {
  filterProductionHistory,
  groupProductionAttempts,
  productionHistoryMarkdown,
  productionStats,
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
  progress: ProductionProgress[]
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
  const [scope, setScope] = useState<'all' | 'article'>('article')
  const [mode, setMode] = useState<ProductionMode | 'all'>('all')
  const [topic, setTopic] = useState('')
  const [selected, setSelected] = useState<string | null>(null)

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
  const trend = useMemo(() => productionTrend(filtered, new Date().toISOString()), [filtered])
  const topErrors = useMemo(() => productionTopErrors(filtered), [filtered])
  const groups = useMemo(() => groupProductionAttempts(filtered), [filtered])
  const group = groups.find((g) => g.key === selected) ?? groups[0] ?? null
  const due = progress.filter((p) => new Date(p.dueAt).getTime() <= Date.now())
  const weak = progress.filter((p) => p.misses > 0 || p.hits / Math.max(1, p.attempts) < 0.7)

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
        <span>到期 {due.length}</span>
        <span>薄弱 {weak.length}</span>
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
            {groups.map((g) => {
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
                    {last?.feedback.total}/{last?.feedback.max}
                  </span>
                </button>
              )
            })}
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
                        {rec.feedback.total}/{rec.feedback.max}
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
                          <span key={h.id} className={h.used ? 'ok' : 'bad'}>
                            {h.text}：{h.used ? '用上了' : '没用上'}
                          </span>
                        ))}
                      </div>
                    )}
                    {rec.feedback.summary && <div className="muted">总评：{rec.feedback.summary}</div>}
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
