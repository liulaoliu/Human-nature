// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import type { ImitationTask, WritingFeedback, WritingRecord } from '../../core/writing'
import WritingPanel, { type WritingPanelProps } from './WritingPanel'
import { recordKeyOf } from './golden/WritingHoverCard'

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
  issues: [
    {
      original: 'I runned',
      suggestion: 'I ran',
      reason: '时态',
      type: 'grammar',
      rule: 'tense-choice',
      key: 'tense-choice',
      severity: 'must-fix',
    },
  ],
  polished: 'I ran fast.',
  summary: '继续加油',
}

const history: WritingRecord[] = [
  {
    at: '2026-10-20T00:00:00.000Z',
    articleId: 'doc:1',
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
    articleId: 'doc:1',
    articleTitle: '文章一',
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

describe('WritingPanel：历史（URL 驱动）', () => {
  it('点「历史」把子视图写进地址，不在组件里自己展开', () => {
    const onNavigateWrite = vi.fn()
    render(<WritingPanel {...props({ onNavigateWrite })} />)
    fireEvent.click(screen.getByRole('button', { name: '历史（0）' }))
    expect(onNavigateWrite).toHaveBeenCalledWith({ view: 'history', scope: 'article' })
  })

  it('地址里是 wv=history 时直接渲染历史；没历史给占位，不能清空', () => {
    render(<WritingPanel {...props({ writeRoute: { view: 'history' }, onNavigateWrite: vi.fn() })} />)
    expect(screen.getByText(/还没有.*记录/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: '清空' })).toBeNull()
    expect(screen.queryByRole('button', { name: '② 批改' })).toBeNull()
  })

  it('点一条记录写地址（带 recordKey），不直接灌表单；清空走回调', () => {
    const onLoadRecord = vi.fn()
    const onClearHistory = vi.fn()
    const onNavigateWrite = vi.fn()
    const { rerender } = render(
      <WritingPanel
        {...props({ history, onLoadRecord, onClearHistory, writeRoute: { view: 'history' }, onNavigateWrite })}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: /第 1 次/ }))
    expect(onNavigateWrite).toHaveBeenCalledWith(
      { view: 'history', recordKey: expect.any(String), scope: 'article' },
      { replace: false },
    )
    expect(onLoadRecord).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: '清空' }))
    expect(onClearHistory).toHaveBeenCalledWith({
      source: 'all',
      scope: 'article',
      articleId: 'doc:1',
    })

    // 地址里带上 recordKey → 直接摊开那一条
    rerender(
      <WritingPanel
        {...props({
          history,
          onLoadRecord,
          writeRoute: { view: 'history', recordKey: recordKeyOf(history[0] as WritingRecord) },
          onNavigateWrite,
        })}
      />,
    )
    expect(screen.getByText('I ran.')).toBeTruthy()
  })

  it('详情里点「载入到表单继续改」才灌表单，并退回仿写主界面', () => {
    const onLoadRecord = vi.fn()
    const onNavigateWrite = vi.fn()
    render(
      <WritingPanel
        {...props({
          history,
          onLoadRecord,
          writeRoute: { view: 'history', recordKey: recordKeyOf(history[0] as WritingRecord) },
          onNavigateWrite,
        })}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: '载入到表单继续改' }))
    expect(onLoadRecord).toHaveBeenCalledWith(history[0])
    expect(onNavigateWrite).toHaveBeenCalledWith({}, { replace: true })
  })

  it('拷打造句记录在仿写历史里也有来源标签', () => {
    const drill: WritingRecord = {
      at: '2026-11-08T00:00:00.000Z',
      articleId: 'doc:1',
      model: '',
      text: 'I run every day.',
      feedback,
      task: { task: '用 run 造句', model: '', mustUse: ['run'], rubric: [] },
      source: 'drillSentence',
      sentenceId: 'drill:memory:test',
    }
    render(
      <WritingPanel
        {...props({
          history: [...history, drill],
          writeRoute: { view: 'history' },
          onNavigateWrite: vi.fn(),
        })}
      />,
    )
    expect(screen.getByText('拷打造句')).toBeTruthy()
  })

  it('结束按钮回调', () => {
    const onClose = vi.fn()
    render(<WritingPanel {...props({ onClose })} />)
    fireEvent.click(screen.getByRole('button', { name: '结束（Esc）' }))
    expect(onClose).toHaveBeenCalled()
  })

  it('历史子视图里也有「结束」，从精读进来关掉会回到精读（back 由 URL 决定）', () => {
    const onClose = vi.fn()
    render(<WritingPanel {...props({ onClose, writeRoute: { view: 'history' }, onNavigateWrite: vi.fn() })} />)
    fireEvent.click(screen.getByRole('button', { name: '结束（Esc）' }))
    expect(onClose).toHaveBeenCalled()
  })
})
