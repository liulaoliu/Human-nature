import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
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
 * 用 fixed 定位而不是 absolute：absolute 卡片会撑大列表的滚动区域，
 * 鼠标靠近最后几条时滚动条反复出现/消失，列表就会跳。fixed 不参与布局，
 * 再根据行是否靠近视口底部决定向上/向下弹。
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
  const anchor = useRef<HTMLDivElement>(null)
  const [hovered, setHovered] = useState(false)
  const [focused, setFocused] = useState(false)
  const [style, setStyle] = useState<CSSProperties>()
  const open = hovered || focused

  const place = () => {
    const el = anchor.current
    if (!el || typeof window === 'undefined') return
    const rect = el.getBoundingClientRect()
    const width = Math.min(430, window.innerWidth * 0.86)
    const left = Math.max(8, Math.min(rect.left, window.innerWidth - width - 8))
    // 下方不够 240px 就翻到上方；卡片用 transform 收起自身高度，不会撑滚动区。
    const below = rect.bottom + 240 < window.innerHeight
    setStyle({
      left,
      top: below ? rect.bottom + 6 : rect.top - 6,
      width,
      ...(below ? {} : { transform: 'translateY(-100%)' }),
    })
  }

  useEffect(() => {
    if (!open) return
    const hide = () => {
      setHovered(false)
      setFocused(false)
    }
    window.addEventListener('scroll', hide, true)
    window.addEventListener('resize', hide)
    return () => {
      window.removeEventListener('scroll', hide, true)
      window.removeEventListener('resize', hide)
    }
  }, [open])

  return (
    <div
      ref={anchor}
      className={`golden-hover ${className}`.trim()}
      onMouseEnter={() => {
        place()
        setHovered(true)
      }}
      onMouseLeave={() => setHovered(false)}
      onFocus={() => {
        place()
        setFocused(true)
      }}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setFocused(false)
      }}
    >
      {children}
      {open && (
        <div className="golden-hover-card" style={style} role="tooltip">
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
      )}
    </div>
  )
}

export function recordKeyOf(rec: WritingRecord): string {
  return rec.recordKey || writingRecordKey(rec)
}
