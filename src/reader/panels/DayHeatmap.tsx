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
  /** 自定义格子提示文案（默认是「点击加入 / 移出」的筛选语义） */
  titleFor?: (day: string, count: number, selected: boolean) => string
  /** 图例末尾的说明，默认「（点格子选日期）」 */
  hint?: string
}

/**
 * 日期热力图选择器（点格子加 / 减；未来和没内容的天不可点）。
 *
 * 从 `ExportPanel` 抽出来：导出面板和生词浏览页共用同一套「哪天有内容、点格子选日」的交互，
 * 各写一份 CSS 结构和 title 文案迟早会漂。日历分档仍只走 `core/activity.buildHeatmap`。
 *
 * 统计面板复用同一套格子看「某天明细」，只是文案语义不同（`titleFor` / `hint`），
 * 所以这里不写死「加入 / 移出」。有内容的格子同时可点、可 Tab 聚焦、可回车 / 空格触发。
 */
export default function DayHeatmap({
  dates,
  picked,
  onToggle,
  weeks = 13,
  today,
  titleFor,
  hint = '（点格子选日期）',
}: DayHeatmapProps) {
  const counts = useMemo(() => Object.fromEntries(dates), [dates])
  const heat = useMemo(() => buildHeatmap(counts, weeks, today), [counts, weeks, today])
  /**
   * 周数越多格子越小：不再给 `minWidth`（52 周会被撑到 780px、把最近几周挤出侧栏），
   * 改成「按容器宽度均分 + 间距随周数收缩」，任何周数都能一眼看全，不需要横向滚动。
   */
  const gap = weeks > 40 ? 1 : weeks > 20 ? 2 : 3
  const columns = { gridTemplateColumns: `repeat(${weeks}, 1fr)`, gap: `${gap}px` }
  /** 52 周时月份标签挤在一起，隔 3 个月标一次；26 周隔 2 个月。 */
  const labelStep = weeks > 40 ? 3 : weeks > 20 ? 2 : 1
  const months = heat.monthLabels.filter((_, i) => i % labelStep === 0)

  return (
    <div className="exheat">
      <div className="heat">
        <div className="heat-months" style={columns}>
          {months.map((m) => (
            <span key={`${m.col}-${m.label}`} style={{ gridColumn: m.col + 1 }}>
              {m.label}月
            </span>
          ))}
        </div>
        <div className="heat-grid" style={columns}>
          {heat.cells.map((col, ci) =>
            col.map((cell, ri) => {
              const on = picked.has(cell.key)
              const count = counts[cell.key] ?? 0
              const usable = !cell.future && count > 0
              const title = cell.future
                ? ''
                : usable
                  ? (titleFor?.(cell.key, count, on) ?? `${cell.key}：${count} 条（点击${on ? '移出' : '加入'}）`)
                  : `${cell.key}：没有内容`
              return (
                <span
                  key={`${ci}-${ri}`}
                  className={
                    'heat-cell' +
                    (cell.future ? ' future' : ' lv' + cell.level) +
                    (on ? ' on' : '') +
                    (usable ? ' act' : '')
                  }
                  title={title}
                  role={usable ? 'button' : undefined}
                  tabIndex={usable ? 0 : undefined}
                  aria-label={usable ? title : undefined}
                  aria-pressed={usable ? on : undefined}
                  onClick={usable ? () => onToggle(cell.key) : undefined}
                  onKeyDown={
                    usable
                      ? (e) => {
                          if (e.key !== 'Enter' && e.key !== ' ') return
                          e.preventDefault()
                          onToggle(cell.key)
                        }
                      : undefined
                  }
                />
              )
            }),
          )}
        </div>
      </div>
      <div className="muted heat-legend">
        少 <span className="heat-cell lv0" /> <span className="heat-cell lv1" />{' '}
        <span className="heat-cell lv2" /> <span className="heat-cell lv3" /> <span className="heat-cell lv4" />{' '}
        多{hint}
      </div>
    </div>
  )
}
