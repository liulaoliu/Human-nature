// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render } from '@testing-library/react'
import DayHeatmap from './DayHeatmap'

/**
 * 热力图选日：点有内容的格子加/移出；未来和没内容的天不可点。
 * 日历分档在 `core/activity.buildHeatmap` 单测；这里只测点击接线。
 */
const today = new Date(2026, 9, 26)

function cell(day: string): HTMLElement | null {
  return document.querySelector(`.heat-cell[title^="${day}："]`)
}

describe('DayHeatmap', () => {
  it('有内容的天可点，点一下把日期交给 onToggle', () => {
    const onToggle = vi.fn()
    render(<DayHeatmap dates={[['2026-10-01', 2]]} picked={new Set()} onToggle={onToggle} today={today} />)
    const el = cell('2026-10-01')!
    expect(el.className).toContain('act')
    expect(el.getAttribute('title')).toContain('2 条')
    fireEvent.click(el)
    expect(onToggle).toHaveBeenCalledWith('2026-10-01')
  })

  it('已选中的天有 on 样式，再点是移出语义（照常回调）', () => {
    const onToggle = vi.fn()
    render(
      <DayHeatmap dates={[['2026-10-01', 2]]} picked={new Set(['2026-10-01'])} onToggle={onToggle} today={today} />,
    )
    const el = cell('2026-10-01')!
    expect(el.className).toContain('on')
    expect(el.getAttribute('title')).toContain('移出')
    fireEvent.click(el)
    expect(onToggle).toHaveBeenCalledWith('2026-10-01')
  })

  it('未来 / 没内容的天不可点', () => {
    const onToggle = vi.fn()
    render(
      <DayHeatmap
        dates={[
          ['2026-10-01', 2],
          ['2026-10-27', 1],
        ]}
        picked={new Set()}
        onToggle={onToggle}
        today={today}
      />,
    )
    const future = document.querySelector('.heat-cell.future') as HTMLElement
    expect(future).toBeTruthy()
    expect(future.getAttribute('title')).toBe('')
    fireEvent.click(future)

    const empty = cell('2026-10-02')!
    expect(empty.getAttribute('title')).toContain('没有内容')
    expect(empty.className).not.toContain('act')
    fireEvent.click(empty)
    expect(onToggle).not.toHaveBeenCalled()
  })
})
