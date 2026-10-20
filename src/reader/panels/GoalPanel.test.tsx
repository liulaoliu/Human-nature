// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { dayKeyLocal } from '../../core/activity'
import type { ReadDone } from '../../core/goals'
import GoalPanel, { type GoalPanelProps } from './GoalPanel'

const today = '2026-10-20'
const yesterday = '2026-10-19'

function done(over: Partial<ReadDone> = {}): ReadDone {
  return {
    day: today,
    articleId: 'doc:1',
    title: 'Article',
    at: `${today}T09:05:00.000Z`,
    ...over,
  }
}

function props(over: Partial<GoalPanelProps> = {}): GoalPanelProps {
  const noop = vi.fn()
  return {
    onClose: noop,
    todayKey: today,
    done: [],
    allDone: [],
    goal: 0,
    onGoalChange: noop,
    memo: '',
    onMemoChange: noop,
    articleTitle: 'My article',
    articleDone: false,
    articleReadDay: null,
    onMarkDone: noop,
    onUndo: noop,
    ...over,
  }
}

describe('GoalPanel：今日读文', () => {
  it('没设目标显示篇数；没读完给提示；可设目标', () => {
    const onGoalChange = vi.fn()
    render(<GoalPanel {...props({ onGoalChange })} />)
    expect(screen.getByText('0 篇')).toBeTruthy()
    expect(screen.getByText('今天还没读完文章')).toBeTruthy()
    fireEvent.change(screen.getByLabelText(/目标/), { target: { value: '2' } })
    expect(onGoalChange).toHaveBeenCalledWith(2)
  })

  it('有目标显示进度；达标打勾', () => {
    const { rerender } = render(<GoalPanel {...props({ goal: 2, done: [done()] })} />)
    expect(screen.getByText('1/2 篇')).toBeTruthy()
    rerender(<GoalPanel {...props({ goal: 2, done: [done(), done({ articleId: 'doc:2' })] })} />)
    expect(screen.getByText(/2\/2 篇/)).toBeTruthy()
    expect(screen.getByText(/2\/2 篇 ✅/)).toBeTruthy()
  })

  it('标记读完：未完成可点，完成后显示哪天读完', () => {
    const onMarkDone = vi.fn()
    const { rerender } = render(<GoalPanel {...props({ onMarkDone })} />)
    fireEvent.click(screen.getByRole('button', { name: '把《My article》标记读完' }))
    expect(onMarkDone).toHaveBeenCalled()

    rerender(<GoalPanel {...props({ articleDone: true, articleReadDay: today })} />)
    expect((screen.getByRole('button', { name: '当前篇已算读完 ✓' }) as HTMLButtonElement).disabled).toBe(true)

    rerender(<GoalPanel {...props({ articleDone: true, articleReadDay: yesterday })} />)
    expect(screen.getByText(`当前篇已于 ${yesterday} 读完 ✓`)).toBeTruthy()
  })

  it('今日读完列表显示时间/标题；可撤销', () => {
    const onUndo = vi.fn()
    render(<GoalPanel {...props({ done: [done()], onUndo })} />)
    expect(screen.getByText('09:05')).toBeTruthy()
    expect(screen.getAllByText('Article').length).toBeGreaterThan(0)
    fireEvent.click(screen.getAllByRole('button', { name: '撤销这篇的读完' })[0])
    expect(onUndo).toHaveBeenCalledWith('doc:1')
  })
})

describe('GoalPanel：历史与备忘', () => {
  it('历史不含今天；没有更早记录时给提示', () => {
    render(<GoalPanel {...props({ allDone: [done()] })} />)
    expect(screen.getByText('还没有更早的记录')).toBeTruthy()
  })

  it('累计篇数/天数；历史按天分组', () => {
    render(
      <GoalPanel
        {...props({
          allDone: [done(), done({ day: yesterday, articleId: 'doc:2', title: 'Old' })],
        })}
      />,
    )
    expect(screen.getByText(/累计 2 篇 · 2 天/)).toBeTruthy()
    expect(screen.getByText(yesterday)).toBeTruthy()
    expect(screen.getByText('Old')).toBeTruthy()
  })

  it('历史超过 7 天时可展开全部', () => {
    const allDone = Array.from({ length: 9 }, (_, i) => {
      const d = new Date(2026, 9, 10 + i)
      const key = dayKeyLocal(d)
      return done({ day: key, articleId: `doc:${i}`, title: `A${i}`, at: `${key}T10:00:00.000Z` })
    })
    render(<GoalPanel {...props({ todayKey: '2026-10-20', allDone })} />)
    expect(screen.getByRole('button', { name: /展开全部（还有 2 天）/ })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /展开全部/ }))
    expect(screen.getByRole('button', { name: '只看最近 7 天' })).toBeTruthy()
  })

  it('点热力图某天只看那天；可取消筛选', () => {
    const day = dayKeyLocal(new Date(Date.now() - 86400000))
    render(
      <GoalPanel
        {...props({
          done: [],
          allDone: [
            done({ day, articleId: 'doc:9', title: 'Picked', at: `${day}T08:00:00.000Z` }),
            done({ day: '2020-01-01', articleId: 'doc:x', title: 'TooOld', at: '2020-01-01T08:00:00.000Z' }),
          ],
        })}
      />,
    )
    const cell = document.querySelector(`.heat-cell[title^="${day}："]`) as HTMLElement
    expect(cell).toBeTruthy()
    fireEvent.click(cell)
    expect(screen.getByText(/取消筛选/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /取消筛选/ }))
    expect(screen.queryByText(/取消筛选/)).toBeNull()
  })

  it('备忘受控；点遮罩关闭、点面板不关闭', () => {
    const onMemoChange = vi.fn()
    const onClose = vi.fn()
    const { container } = render(<GoalPanel {...props({ onMemoChange, onClose })} />)
    fireEvent.change(screen.getByPlaceholderText(/想记的随手写在这/), { target: { value: 'note' } })
    expect(onMemoChange).toHaveBeenCalledWith('note')

    fireEvent.click(screen.getByText('📌 目标备忘'))
    expect(onClose).not.toHaveBeenCalled()
    fireEvent.click(container.querySelector('.plan-overlay') as HTMLElement)
    expect(onClose).toHaveBeenCalled()
  })
})
