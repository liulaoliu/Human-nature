// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { installFakeStorage } from '../testStorage'
import PlanPanel, { type PlanPanelProps } from './PlanPanel'

function props(over: Partial<PlanPanelProps> = {}): PlanPanelProps {
  const noop = vi.fn()
  return {
    onClose: noop,
    hasDoc: true,
    articleTitle: 'My article',
    todoPending: 0,
    todayCards: 3,
    todayWrites: 1,
    todayKey: '2026-10-20',
    onNewArticle: noop,
    onStartStudy: noop,
    onOpenSpeedRead: noop,
    ...over,
  }
}

let restore: () => void = () => {}

beforeEach(() => {
  restore = installFakeStorage()
})

afterEach(() => {
  restore()
  vi.restoreAllMocks()
})

describe('PlanPanel', () => {
  it('渲染五步清单、进度与数据提示', () => {
    render(<PlanPanel {...props()} />)
    expect(screen.getByText('📋 今日计划')).toBeTruthy()
    expect(screen.getByText(/清单 0\/5/)).toBeTruthy()
    expect(screen.getByText('✅ 本篇待办已完成')).toBeTruthy()
    expect(screen.getByText('今天 3 张')).toBeTruthy()
    expect(screen.getByText('今天 1 条')).toBeTruthy()
    expect(screen.getByText(/当前这篇/)).toBeTruthy()
  })

  it('待办未清 / 没文章 / 没背没写：对应提示', () => {
    render(
      <PlanPanel
        {...props({
          hasDoc: false,
          todoPending: 4,
          todayCards: 0,
          todayWrites: 0,
          articleTitle: '',
        })}
      />,
    )
    expect(screen.getByText('还没打开文章')).toBeTruthy()
    expect(screen.getByText('今天还没背')).toBeTruthy()
    expect(screen.getByText('今天还没写')).toBeTruthy()
    expect(screen.queryByText(/当前这篇/)).toBeNull()
  })

  it('勾选按天持久化，重挂载后恢复', () => {
    const { unmount } = render(<PlanPanel {...props()} />)
    const boxes = screen.getAllByRole('checkbox')
    fireEvent.click(boxes[0])
    expect(JSON.parse(localStorage.getItem('reader:plan:2026-10-20') ?? '{}').checked).toEqual(['read'])
    expect(screen.getByText(/清单 1\/5/)).toBeTruthy()
    unmount()

    render(<PlanPanel {...props()} />)
    expect((screen.getAllByRole('checkbox')[0] as HTMLInputElement).checked).toBe(true)
  })

  it('换天时读新一天的清单，不串天', () => {
    localStorage.setItem('reader:plan:2026-10-19', JSON.stringify({ checked: ['read', 'speed'] }))
    const { rerender } = render(<PlanPanel {...props({ todayKey: '2026-10-19' })} />)
    expect(screen.getByText(/清单 2\/5/)).toBeTruthy()

    rerender(<PlanPanel {...props({ todayKey: '2026-10-20' })} />)
    expect(screen.getByText(/清单 0\/5/)).toBeTruthy()
  })

  it('点遮罩关闭；点面板本身不关闭', () => {
    const onClose = vi.fn()
    const { container } = render(<PlanPanel {...props({ onClose })} />)
    fireEvent.click(screen.getByText('📋 今日计划'))
    expect(onClose).not.toHaveBeenCalled()

    fireEvent.click(container.querySelector('.plan-overlay') as HTMLElement)
    expect(onClose).toHaveBeenCalled()
  })

  it('没文章时速读/背词入口禁用；新建入口始终可用', () => {
    const onNewArticle = vi.fn()
    const onStartStudy = vi.fn()
    const onOpenSpeedRead = vi.fn()
    const { rerender } = render(
      <PlanPanel
        {...props({ hasDoc: false, onNewArticle, onStartStudy, onOpenSpeedRead })}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: '＋ 新建 / 导入文章' }))
    expect(onNewArticle).toHaveBeenCalled()
    expect((screen.getByRole('button', { name: '逐句速读' }) as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByRole('button', { name: '去背单词' }) as HTMLButtonElement).disabled).toBe(true)

    rerender(<PlanPanel {...props({ hasDoc: true, onStartStudy, onOpenSpeedRead })} />)
    fireEvent.click(screen.getByRole('button', { name: '逐句速读' }))
    fireEvent.click(screen.getByRole('button', { name: '去背单词' }))
    expect(onOpenSpeedRead).toHaveBeenCalled()
    expect(onStartStudy).toHaveBeenCalled()
  })
})
