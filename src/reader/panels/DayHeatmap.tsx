import { useMemo } from 'react'
import { buildHeatmap } from '../../core/activity'

export interface DayHeatmapProps {
  /** 有内容的日期（倒序或顺序都行）+ 当天条数 */
  dates: [string, number][]
  /** 已选日期；空集合由调用方解释（生词浏览页 = 全部） */
  picked: ReadonlySet<string>
  onToggle: (day: string) => void
  /** 画多少周（默认 13，和活动 / 导出面板一致） */
  weeks?: number
  /** 测试固定「今天」；不传 = 现在 */
  today?: Date
}

/**
 * 日期热力图选择器（点格子加 / 减；未来和没内容的天不可点）。
 *
 * 从 `ExportPanel` 抽出来：导出面板和生词浏览页共用同一套「哪天有内容、点格子选日」的交互，
 * 各写一份 CSS 结构和 title 文案迟早会漂。日历分档仍只走 `core/activity.buildHeatmap`。
 */
export default function DayHeatmap({ dates, picked, onToggle, weeks = 13, today }: DayHeatmapProps) {
  const counts = useMemo(() => Object.fromEntries(dates), [dates])
  const heat = useMemo(() => buildHeatmap(counts, weeks, today), [counts, weeks, today])

  return (
    <div className="exheat">
      <div className="heat">
        <div className="heat-months">
          {heat.monthLabels.map((m) => (
            <span key={`${m.col}-${m.label}`} style={{ gridColumn: m.col + 1 }}>
              {m.label}月
            </span>
          ))}
        </div>
        <div className="heat-grid">
          {heat.cells.map((col, ci) =>
            col.map((cell, ri) => {
              const on = picked.has(cell.key)
              const usable = !cell.future && (counts[cell.key] ?? 0) > 0
              return (
                <span
                  key={`${ci}-${ri}`}
                  className={
                    'heat-cell' +
                    (cell.future ? ' future' : ' lv' + cell.level) +
                    (on ? ' on' : '') +
                    (usable ? ' act' : '')
                  }
                  title={
                    cell.future
                      ? ''
                      : usable
                        ? `${cell.key}：${cell.count} 条（点击${on ? '移出' : '加入'}）`
                        : `${cell.key}：没有内容`
                  }
                  onClick={usable ? () => onToggle(cell.key) : undefined}
                />
              )
            }),
          )}
        </div>
      </div>
      <div className="muted heat-legend">
        少 <span className="heat-cell lv0" /> <span className="heat-cell lv1" />{' '}
        <span className="heat-cell lv2" /> <span className="heat-cell lv3" /> <span className="heat-cell lv4" />{' '}
        多（点格子选日期）
      </div>
    </div>
  )
}
