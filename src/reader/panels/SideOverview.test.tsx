// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import type { MistakeEntry } from '../../core/mistakes'
import type { ReadyRow } from '../../core/readiness'
import SideOverview, { type SideOverviewProps } from './SideOverview'

const mistakes: MistakeEntry[] = [
  { id: 'vocab:v1', kind: 'vocab', at: '2026-10-20T00:00:00.000Z', count: 1, label: 'run' },
  { id: 'listen:q1', kind: 'listen', at: '2026-10-20T00:00:00.000Z', count: 1, label: 'Q1' },
]

const readyRows: ReadyRow[] = [
  { group: '读', key: 'read', label: '精读', level: 'ready', detail: '1 篇', hint: '继续' },
  { group: '词', key: 'vocab', label: '词汇', level: 'partial', detail: '12 个到期' },
  { group: '写', key: 'write', label: '仿写', level: 'blocked', detail: '0 条' },
]

function props(over: Partial<SideOverviewProps> = {}): SideOverviewProps {
  const noop = vi.fn()
  return {
    mistakes,
    readyRows,
    boardAction: () => null,
    onRetryVocab: noop,
    onSiege: noop,
    onRetryListen: noop,
    onRetryDict: noop,
    onClearMistakes: noop,
    ...over,
  }
}

describe('SideOverview：错题本', () => {
  it('没有错题时不渲染错题本；有错题按类别显示条数，空类别禁用', () => {
    const { rerender } = render(<SideOverview {...props({ mistakes: [] })} />)
    expect(screen.queryByText(/错题本/)).toBeNull()

    rerender(<SideOverview {...props()} />)
    expect(screen.getByText('错题本（2）')).toBeTruthy()
    expect(screen.getByText('考试错词')).toBeTruthy()
    expect(screen.getByText('听力错题')).toBeTruthy()
    expect(screen.getByText('听写漏词')).toBeTruthy()

    const rows = screen.getAllByRole('button', { name: '重练' }) as HTMLButtonElement[]
    expect(rows.map((b) => b.disabled)).toEqual([false, false, true])
  })

  it('重练 / 包围战 / 清空都走回调', () => {
    const onRetryVocab = vi.fn()
    const onRetryListen = vi.fn()
    const onSiege = vi.fn()
    const onClearMistakes = vi.fn()
    render(<SideOverview {...props({ onRetryVocab, onRetryListen, onSiege, onClearMistakes })} />)
    const rows = screen.getAllByRole('button', { name: '重练' })
    fireEvent.click(rows[0])
    fireEvent.click(rows[1])
    expect(onRetryVocab).toHaveBeenCalled()
    expect(onRetryListen).toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: /错题包围战/ }))
    expect(onSiege).toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: '清空错题本' }))
    expect(onClearMistakes).toHaveBeenCalled()
  })

  it('没有词汇错题时包围战不可点', () => {
    render(<SideOverview {...props({ mistakes: [mistakes[1]] })} />)
    expect((screen.getByRole('button', { name: /错题包围战/ }) as HTMLButtonElement).disabled).toBe(true)
  })
})

describe('SideOverview：就绪度', () => {
  it('按分组渲染行；有 action 才显示按钮', () => {
    const run = vi.fn()
    render(
      <SideOverview
        {...props({
          mistakes: [],
          boardAction: (key) => (key === 'vocab' ? { label: '去背词', run } : null),
        })}
      />,
    )
    expect(screen.getByText('精读')).toBeTruthy()
    expect(screen.getByText('继续')).toBeTruthy()
    expect(screen.getByText('12 个到期')).toBeTruthy()
    expect(screen.getByText('0 条')).toBeTruthy()
    expect(screen.queryByRole('button', { name: '去背词' })).toBeTruthy()
    expect(screen.getAllByRole('button', { name: '去背词' })).toHaveLength(1)
    fireEvent.click(screen.getByRole('button', { name: '去背词' }))
    expect(run).toHaveBeenCalled()
  })

  it('空分组不渲染标题', () => {
    render(
      <SideOverview
        {...props({ mistakes: [], readyRows: [readyRows[0]], boardAction: () => null })}
      />,
    )
    expect(screen.getByText('读')).toBeTruthy()
    expect(screen.queryByText('词')).toBeNull()
    expect(screen.queryByText('写')).toBeNull()
  })
})
