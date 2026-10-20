// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import type { ImitationTask, WritingFeedback, WritingRecord } from '../../core/writing'
import WritingPanel, { type WritingPanelProps } from './WritingPanel'

const task: ImitationTask = {
  task: '仿写一句',
  model: 'Run fast.',
  structure: 'SV',
  mustUse: ['run', 'fast'],
  rubric: [{ dimension: '语法', weight: 1 }],
}

const feedback: WritingFeedback = {
  total: 8,
  max: 10,
  scores: [{ dimension: '语法', score: 8, max: 10, comment: '不错' }],
  issues: [{ original: 'I runned', suggestion: 'I ran', reason: '时态' }],
  polished: 'I ran fast.',
  summary: '继续加油',
}

const history: WritingRecord[] = [
  {
    at: '2026-10-20T00:00:00.000Z',
    model: 'Run fast.',
    text: 'I ran.',
    feedback,
    task,
  },
]

function props(over: Partial<WritingPanelProps> = {}): WritingPanelProps {
  const noop = vi.fn()
  return {
    model: 'Run fast.',
    text: '',
    task: null,
    feedback: null,
    history: [],
    onClose: noop,
    onGenerateTask: noop,
    onFeedback: noop,
    onModelChange: noop,
    onTextChange: noop,
    onClearHistory: noop,
    onLoadRecord: noop,
    ...over,
  }
}

describe('WritingPanel：任务与批改', () => {
  it('没任务 / 没作答时批改不可点；都有才可点', () => {
    const { rerender } = render(<WritingPanel {...props()} />)
    expect((screen.getByRole('button', { name: '② 批改' }) as HTMLButtonElement).disabled).toBe(true)

    rerender(<WritingPanel {...props({ task, text: '   ' })} />)
    expect((screen.getByRole('button', { name: '② 批改' }) as HTMLButtonElement).disabled).toBe(true)

    rerender(<WritingPanel {...props({ task, text: 'I ran.' })} />)
    expect((screen.getByRole('button', { name: '② 批改' }) as HTMLButtonElement).disabled).toBe(false)
  })

  it('范句 / 我的仿写受控；生成任务走回调', () => {
    const onModelChange = vi.fn()
    const onTextChange = vi.fn()
    const onGenerateTask = vi.fn()
    render(<WritingPanel {...props({ onModelChange, onTextChange, onGenerateTask })} />)
    fireEvent.change(screen.getByDisplayValue('Run fast.'), { target: { value: 'Walk slow.' } })
    fireEvent.change(screen.getByPlaceholderText(/在这里写/), { target: { value: 'I walk.' } })
    fireEvent.click(screen.getByRole('button', { name: '① 生成任务' }))
    expect(onModelChange).toHaveBeenCalledWith('Walk slow.')
    expect(onTextChange).toHaveBeenCalledWith('I walk.')
    expect(onGenerateTask).toHaveBeenCalled()
  })

  it('任务详情与批改结果完整展示', () => {
    render(<WritingPanel {...props({ task, text: 'I ran.', feedback })} />)
    expect(screen.getByText('仿写一句')).toBeTruthy()
    expect(screen.getByText('结构：SV')).toBeTruthy()
    expect(screen.getByText('必须用上：run、fast')).toBeTruthy()
    expect(screen.getByText('评分：语法(1)')).toBeTruthy()
    expect(screen.getByText('得分：8/10')).toBeTruthy()
    expect(screen.getByText(/语法：8\/10 — 不错/)).toBeTruthy()
    expect(screen.getByText('I runned')).toBeTruthy()
    expect(screen.getByText('I ran', { selector: '.ok' })).toBeTruthy()
    expect(screen.getByText(/改写示范/)).toBeTruthy()
    expect(screen.getByText('继续加油')).toBeTruthy()
  })
})

describe('WritingPanel：历史', () => {
  it('没历史时打开显示占位；不能清空', () => {
    render(<WritingPanel {...props()} />)
    fireEvent.click(screen.getByRole('button', { name: '历史（0）' }))
    expect(screen.getByText(/还没有记录/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: '清空' })).toBeNull()
  })

  it('点历史记录载入并自动收起；清空走回调', () => {
    const onLoadRecord = vi.fn()
    const onClearHistory = vi.fn()
    render(<WritingPanel {...props({ history, onLoadRecord, onClearHistory })} />)
    fireEvent.click(screen.getByRole('button', { name: '历史（1）' }))
    fireEvent.click(screen.getByRole('button', { name: /Run fast/ }))
    expect(onLoadRecord).toHaveBeenCalledWith(history[0])
    expect(screen.queryByText(/练习历史（1）/)).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: '历史（1）' }))
    fireEvent.click(screen.getByRole('button', { name: '清空' }))
    expect(onClearHistory).toHaveBeenCalled()
  })

  it('结束按钮回调', () => {
    const onClose = vi.fn()
    render(<WritingPanel {...props({ onClose })} />)
    fireEvent.click(screen.getByRole('button', { name: '结束（Esc）' }))
    expect(onClose).toHaveBeenCalled()
  })
})
