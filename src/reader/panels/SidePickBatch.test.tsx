// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import SidePickBatch, { type SidePickBatchProps } from './SidePickBatch'

function props(over: Partial<SidePickBatchProps> = {}): SidePickBatchProps {
  return {
    visibleBatch: [],
    batchCount: 0,
    onRemoveWord: vi.fn(),
    onCommitBatch: vi.fn(),
    onCopyBatchPrompt: vi.fn(),
    onExportBatch: vi.fn(),
    onClearBatch: vi.fn(),
    ...over,
  }
}

const run = { word: 'run', sentence: 'Run fast.', sentenceId: 's1' }

describe('SidePickBatch：待选区', () => {
  it('待选数为 0 时整块不渲染', () => {
    const { container } = render(<SidePickBatch {...props()} />)
    expect(container.firstChild).toBeNull()
  })

  it('待选词可点掉；批量按钮在清单为空时禁用', () => {
    const onRemoveWord = vi.fn()
    render(<SidePickBatch {...props({ batchCount: 1, visibleBatch: [run], onRemoveWord })} />)
    fireEvent.click(screen.getByRole('button', { name: 'run ×' }))
    expect(onRemoveWord).toHaveBeenCalledWith(run)
    expect((screen.getByRole('button', { name: '加入生词本' }) as HTMLButtonElement).disabled).toBe(false)
  })

  it('都入库时只给提示，批量操作禁用', () => {
    render(<SidePickBatch {...props({ batchCount: 2 })} />)
    expect(screen.getAllByText(/都已在生词本里/).length).toBeGreaterThan(0)
    expect((screen.getByRole('button', { name: '导出 CSV' }) as HTMLButtonElement).disabled).toBe(true)
  })
})
