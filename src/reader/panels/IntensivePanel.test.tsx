// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import type { IntensivePlan } from '../../core/intensive'
import type { OutputBoard } from '../../core/output'
import IntensivePanel, { type IntensivePanelProps } from './IntensivePanel'

const plan: IntensivePlan = {
  level: 2,
  levelLabel: '产出',
  levelDesc: '能复述、能仿写',
  progress: 60,
  nextKey: 'recall',
  nextLabel: '去背单词',
  nextHint: '先把本篇到期词过一遍',
  stages: [
    { key: 'skim', label: '通读', emoji: '👀', status: 'done', progress: 100, detail: '已通读', action: '去速读', enabled: true },
    { key: 'vocab', label: '查词', emoji: '🔤', status: 'doing', progress: 50, detail: '3/6', action: '补齐音标', enabled: true },
    { key: 'grammar', label: '语法', emoji: '🧠', status: 'todo', progress: 0, detail: '还没跑', action: '补语法', enabled: false },
  ],
}

const board: OutputBoard = {
  score: 62,
  grade: '有产出',
  next: '再写一条仿写',
  rows: [
    { key: 'words', label: '词块', value: '6/10', level: 60, detail: '还差 4 个', good: false },
    { key: 'retell', label: '复述', value: '2 条', level: 100, detail: '达标', good: true },
  ],
}

function props(over: Partial<IntensivePanelProps> = {}): IntensivePanelProps {
  const noop = vi.fn()
  return {
    onClose: noop,
    articleTitle: 'My article',
    hasDoc: true,
    plan,
    skimmed: false,
    onToggleSkimmed: noop,
    onRunBatch: noop,
    batchRunning: false,
    onCancelBatch: noop,
    batchRound: 0,
    batchPhase: '',
    batchDone: 0,
    batchTotal: 0,
    batchError: '',
    board,
    retells: [{ at: '2026-10-20T09:30:00.000Z', text: '讲了大意', words: 12 }],
    onSaveRetell: noop,
    onDeleteRetell: noop,
    onStage: noop,
    onDrill: noop,
    onSiege: noop,
    ...over,
  }
}

describe('IntensivePanel：头部与下一步', () => {
  it('显示档位/总进度/当前文章；下一步有 key 时跳阶段', () => {
    const onStage = vi.fn()
    render(<IntensivePanel {...props({ onStage })} />)
    expect(screen.getByText('🎯 精读工作流')).toBeTruthy()
    expect(screen.getByText('产出')).toBeTruthy()
    expect(screen.getByText('总进度 60%')).toBeTruthy()
    expect(screen.getByText('当前：My article')).toBeTruthy()
    expect(screen.getByText('去背单词')).toBeTruthy()
    expect(screen.getByText('先把本篇到期词过一遍')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '开始这一步' }))
    expect(onStage).toHaveBeenCalledWith('recall')
  })

  it('没有下一步时主按钮跑批；没文章时禁用', () => {
    const onRunBatch = vi.fn()
    const { rerender } = render(
      <IntensivePanel {...props({ onRunBatch, plan: { ...plan, nextKey: null } })} />,
    )
    fireEvent.click(screen.getAllByRole('button', { name: /一键跑批/ })[0])
    expect(onRunBatch).toHaveBeenCalled()

    rerender(<IntensivePanel {...props({ onRunBatch, hasDoc: false, plan: { ...plan, nextKey: null } })} />)
    expect((screen.getAllByRole('button', { name: /一键跑批/ })[0] as HTMLButtonElement).disabled).toBe(true)
  })

  it('跑批中：显示轮次进度、可取消、所有动作锁住', () => {
    const onCancelBatch = vi.fn()
    const onStage = vi.fn()
    render(
      <IntensivePanel
        {...props({
          batchRunning: true,
          batchRound: 2,
          batchPhase: '查词',
          batchDone: 3,
          batchTotal: 8,
          onCancelBatch,
          onStage,
        })}
      />,
    )
    expect(screen.getAllByText(/第 2 轮 · 查词 3\/8/).length).toBeGreaterThan(0)
    expect(screen.getByText(/跑批中：按钮已锁/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '取消' }))
    expect(onCancelBatch).toHaveBeenCalled()
    // 主按钮在跑批中显示进度并禁用（同时保留跑批按钮）
    const progressButtons = screen.getAllByRole('button', { name: /第 2 轮 · 查词 3\/8/ })
    expect(progressButtons.length).toBeGreaterThan(0)
    for (const b of progressButtons) expect((b as HTMLButtonElement).disabled).toBe(true)
    // 阶段按钮也禁用
    expect((screen.getByRole('button', { name: '去速读' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('跑批错误在非运行态显示', () => {
    const { rerender } = render(<IntensivePanel {...props({ batchError: '服务端失联' })} />)
    expect(screen.getByText('跑批出错：服务端失联')).toBeTruthy()
    rerender(<IntensivePanel {...props({ batchError: '服务端失联', batchRunning: true })} />)
    expect(screen.queryByText('跑批出错：服务端失联')).toBeNull()
  })
})

describe('IntensivePanel：看板与阶段', () => {
  it('产出看板渲染分数、行与下一步', () => {
    const { container } = render(<IntensivePanel {...props()} />)
    expect(screen.getByText('产出分 62')).toBeTruthy()
    expect(screen.getByText('有产出')).toBeTruthy()
    expect(screen.getByText('词块')).toBeTruthy()
    expect(screen.getByText('6/10')).toBeTruthy()
    expect(screen.getByText('还差 4 个')).toBeTruthy()
    expect(screen.getByText('下一步：再写一条仿写')).toBeTruthy()
    expect(container.querySelectorAll('.ibrow.good')).toHaveLength(1)
  })

  it('阶段状态/进度/按钮可用性；点击跳转', () => {
    const onStage = vi.fn()
    render(<IntensivePanel {...props({ onStage })} />)
    expect(screen.getByText('已完成')).toBeTruthy()
    expect(screen.getByText('进行中')).toBeTruthy()
    expect(screen.getByText('未开始')).toBeTruthy()
    expect(screen.getByText('50%')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: '补齐音标' }))
    expect(onStage).toHaveBeenCalledWith('vocab')
    expect((screen.getByRole('button', { name: '补语法' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('已通读勾选走回调', () => {
    const onToggleSkimmed = vi.fn()
    const { rerender } = render(<IntensivePanel {...props({ onToggleSkimmed })} />)
    fireEvent.click(screen.getByLabelText('已通读（看懂大意）'))
    expect(onToggleSkimmed).toHaveBeenCalled()
    rerender(<IntensivePanel {...props({ skimmed: true })} />)
    expect((screen.getByLabelText('已通读（看懂大意）') as HTMLInputElement).checked).toBe(true)
  })
})

describe('IntensivePanel：拷打与复述', () => {
  it('六个拷打入口分别回调；没文章时禁用', () => {
    const onDrill = vi.fn()
    const onSiege = vi.fn()
    const { rerender } = render(<IntensivePanel {...props({ onDrill, onSiege })} />)
    const buttons: [string, string][] = [
      ['🥊 记忆拷打', 'memory'],
      ['🧩 词块拷打', 'chunk'],
      ['🇬🇧 英英释义', 'deep'],
      ['🏷 语法标记', 'mark'],
      ['🧠 语法·结构', 'grammar'],
      ['🎧 听力拷打', 'listen'],
    ]
    for (const [label] of buttons) fireEvent.click(screen.getByRole('button', { name: label }))
    expect(onDrill.mock.calls.map((c) => c[0])).toEqual(buttons.map(([, k]) => k))
    fireEvent.click(screen.getByRole('button', { name: /错题包围战/ }))
    expect(onSiege).toHaveBeenCalled()

    rerender(<IntensivePanel {...props({ onDrill, hasDoc: false })} />)
    expect((screen.getByRole('button', { name: '🥊 记忆拷打' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('复述：空文本不能存；保存后清空输入', () => {
    const onSaveRetell = vi.fn()
    render(<IntensivePanel {...props({ onSaveRetell })} />)
    const save = screen.getByRole('button', { name: '保存复述' }) as HTMLButtonElement
    expect(save.disabled).toBe(true)

    fireEvent.change(screen.getByPlaceholderText(/把这段大意讲出来/), { target: { value: '我讲了一遍' } })
    expect(save.disabled).toBe(false)
    fireEvent.click(save)
    expect(onSaveRetell).toHaveBeenCalledWith('我讲了一遍')
    expect((screen.getByPlaceholderText(/把这段大意讲出来/) as HTMLTextAreaElement).value).toBe('')
  })

  it('复述历史只显示最近 3 条，可删除', () => {
    const onDeleteRetell = vi.fn()
    const retells = Array.from({ length: 5 }, (_, i) => ({
      at: `2026-10-2${i}T10:00:00.000Z`,
      text: `第 ${i} 条`,
      words: i,
    }))
    render(<IntensivePanel {...props({ retells, onDeleteRetell })} />)
    expect(screen.getByText('已记录 5 条')).toBeTruthy()
    expect(screen.getAllByRole('button', { name: '删除这条复述' })).toHaveLength(3)
    fireEvent.click(screen.getAllByRole('button', { name: '删除这条复述' })[0])
    expect(onDeleteRetell).toHaveBeenCalledWith(retells[0].at)
  })

  it('点遮罩关闭；点面板不关闭', () => {
    const onClose = vi.fn()
    const { container } = render(<IntensivePanel {...props({ onClose })} />)
    fireEvent.click(screen.getByText('🎯 精读工作流'))
    expect(onClose).not.toHaveBeenCalled()
    fireEvent.click(container.querySelector('.plan-overlay') as HTMLElement)
    expect(onClose).toHaveBeenCalled()
  })
})
