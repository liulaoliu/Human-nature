// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import ReaderSidebar, { type ReaderSidebarProps } from './ReaderSidebar'

// 这里只测「容器」：页签切换与面板接线。五个面板各自的逻辑在各自测试里。
vi.mock('./SideOverview', () => ({
  default: (p: { mistakes?: unknown[] }) => <div data-testid="overview">overview:{p.mistakes?.length ?? 0}</div>,
}))
vi.mock('./SideMastery', () => ({
  default: () => <div data-testid="mastery">mastery</div>,
}))
vi.mock('./StatsPanel', () => ({
  default: () => <div data-testid="stats">stats</div>,
}))
vi.mock('./SidePick', () => ({
  default: (p: { batchCount?: number }) => <div data-testid="pick">pick:{p.batchCount ?? 0}</div>,
}))
vi.mock('./SideVocab', () => ({
  default: () => <div data-testid="vocab">vocab</div>,
}))

function props(over: Partial<ReaderSidebarProps> = {}): ReaderSidebarProps {
  return {
    sideTab: 'overview',
    onSideTabChange: vi.fn(),
    overview: { mistakes: [{ id: 'm1' }] } as never,
    mastery: {} as never,
    stats: {} as never,
    pick: { batchCount: 3 } as never,
    vocab: {} as never,
    ...over,
  }
}

describe('ReaderSidebar', () => {
  it('五个页签；当前页签高亮', () => {
    const { rerender } = render(<ReaderSidebar {...props()} />)
    const tabs = screen.getAllByRole('button')
    expect(tabs.map((b) => b.textContent)).toEqual(['总览', '选词 / 分析', '生词本', '统计', '掌握度'])
    expect((screen.getByRole('button', { name: '总览' }) as HTMLButtonElement).className).toBe('primary')

    rerender(<ReaderSidebar {...props({ sideTab: 'stats' })} />)
    expect((screen.getByRole('button', { name: '统计' }) as HTMLButtonElement).className).toBe('primary')
    expect((screen.getByRole('button', { name: '总览' }) as HTMLButtonElement).className).toBe('')
  })

  it('点页签回调对应 key', () => {
    const onSideTabChange = vi.fn()
    render(<ReaderSidebar {...props({ onSideTabChange })} />)
    for (const label of ['选词 / 分析', '生词本', '统计', '掌握度', '总览']) {
      fireEvent.click(screen.getByRole('button', { name: label }))
    }
    expect(onSideTabChange.mock.calls.map((c) => c[0])).toEqual([
      'pick',
      'vocab',
      'stats',
      'mastery',
      'overview',
    ])
  })

  it('五个面板都挂载，props 按区域透传', () => {
    render(<ReaderSidebar {...props()} />)
    expect(screen.getByTestId('overview').textContent).toBe('overview:1')
    expect(screen.getByTestId('pick').textContent).toBe('pick:3')
    expect(screen.getByTestId('mastery')).toBeTruthy()
    expect(screen.getByTestId('stats')).toBeTruthy()
    expect(screen.getByTestId('vocab')).toBeTruthy()
  })
})
