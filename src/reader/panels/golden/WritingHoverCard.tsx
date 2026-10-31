import type { ReactNode } from 'react'
import { writingRecordKey, writingRecordLabel, type WritingRecord } from '../../../core/writing'

/** 悬浮卡需要的字段；历史行和错因行都从这里喂，避免两套摘要。 */
export interface WritingHoverData {
  title: string
  at?: string
  articleTitle?: string
  text?: string
  score?: string
  original?: string
  suggestion?: string
  reason?: string
  summary?: string
}

export function hoverDataFromRecord(rec: WritingRecord, index?: number): WritingHoverData {
  return {
    title: `${index !== undefined ? `第 ${index + 1} 次 · ` : ''}${writingRecordLabel(rec)}`,
    at: rec.at,
    ...(rec.articleTitle ? { articleTitle: rec.articleTitle } : {}),
    ...(rec.text ? { text: rec.text } : {}),
    ...(rec.feedback.max > 0 ? { score: `${rec.feedback.total}/${rec.feedback.max}` } : {}),
    ...(rec.feedback.summary ? { summary: rec.feedback.summary } : {}),
  }
}

/**
 * 历史行 / 错因行的悬浮摘要。
 *
 * 用 CSS `:hover` / `:focus-within`，不额外维护 React 状态；按钮本身仍可点。
 */
export default function WritingHoverCard({
  data,
  children,
  className = '',
}: {
  data: WritingHoverData
  children: ReactNode
  className?: string
}) {
  return (
    <div className={`golden-hover ${className}`.trim()}>
      {children}
      <div className="golden-hover-card" role="tooltip">
        <b>{data.title}</b>
        <span className="muted">
          {[
            data.at ? data.at.slice(0, 16).replace('T', ' ') : '',
            data.articleTitle,
          ]
            .filter(Boolean)
            .join(' · ')}
        </span>
        {data.text && <span className="golden-hover-text">{data.text}</span>}
        {data.score && <span>评分：{data.score}</span>}
        {(data.original || data.suggestion) && (
          <span>
            {data.original || '（缺词）'} → {data.suggestion || '—'}
          </span>
        )}
        {data.reason && <span className="muted">原因：{data.reason}</span>}
        {data.summary && <span className="muted">总评：{data.summary}</span>}
      </div>
    </div>
  )
}

export function recordKeyOf(rec: WritingRecord): string {
  return rec.recordKey || writingRecordKey(rec)
}
