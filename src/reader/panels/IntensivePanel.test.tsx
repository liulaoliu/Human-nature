// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import type { IntensivePlan } from '../../core/intensive'
import { DEFAULT_DRILL_LIMITS } from '../../core/intensiveDrill'
import type { OutputBoard } from '../../core/output'
import { clearPanelScrollMemory } from '../hooks/usePanelScrollMemory'
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

afterEach(() => {
  clearPanelScrollMemory()
})

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
    drillLimits: { ...DEFAULT_DRILL_LIMITS },
    onDrillLimitChange: noop,
    onSiege: noop,
    onOpenProduction: noop,
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
    fireEvent.click(screen.getAllByRole('button', { name: /D指导指导指导/ })[0])
    expect(onRunBatch).toHaveBeenCalled()

    rerender(<IntensivePanel {...props({ onRunBatch, hasDoc: false, plan: { ...plan, nextKey: null } })} />)
    expect((screen.getAllByRole('button', { name: /D指导指导指导/ })[0] as HTMLButtonElement).disabled).toBe(true)
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
    expect(screen.getByText(/D指导指导指导中：按钮已锁/)).toBeTruthy()
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
    expect(screen.getByText('D指导指导指导出错：服务端失联')).toBeTruthy()
    rerender(<IntensivePanel {...props({ batchError: '服务端失联', batchRunning: true })} />)
    expect(screen.queryByText('D指导指导指导出错：服务端失联')).toBeNull()
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
  it('记忆 / 词块直接进预习页；其它拷打先展开数量选择，确认后才开考', () => {
    const onDrill = vi.fn()
    const onSiege = vi.fn()
    render(<IntensivePanel {...props({ onDrill, onSiege })} />)

    // 有「先看一遍」页的两档：数量在预习页选，这里不再弹数量。
    for (const [label, kind] of [
      ['🥊 记忆拷打', 'memory'],
      ['🧩 词块拷打', 'chunk'],
    ] as const) {
      fireEvent.click(screen.getByRole('button', { name: label }))
      expect(onDrill).toHaveBeenLastCalledWith(kind, 10)
      expect(screen.queryByRole('button', { name: '开始' })).toBeNull()
    }

    const buttons: [string, string, string][] = [
      ['🇬🇧 英英释义', 'deep', '英英释义'],
      ['🏷 语法标记', 'mark', '语法标记'],
      ['🧠 语法·结构', 'grammar', '语法·结构'],
      ['🎧 听力拷打', 'listen', '听力拷打'],
    ]
    for (const [label, kind, name] of buttons) {
      fireEvent.click(screen.getByRole('button', { name: label }))
      // 只是展开选择，还没开考
      expect(onDrill).not.toHaveBeenCalledWith(kind, 10)
      expect((screen.getByLabelText(`${name}每次题数`) as HTMLSelectElement).value).toBe('10')
      fireEvent.click(screen.getByRole('button', { name: '开始' }))
      expect(onDrill).toHaveBeenLastCalledWith(kind, 10)
    }

    fireEvent.click(screen.getByRole('button', { name: /错题包围战/ }))
    expect((screen.getByLabelText('错题包围战每次题数') as HTMLSelectElement).value).toBe('10')
    fireEvent.click(screen.getByRole('button', { name: '开始' }))
    expect(onSiege).toHaveBeenCalledWith(10)
  })

  it('D老师奶牛工棚入口走回调', () => {
    const onOpenProduction = vi.fn()
    render(<IntensivePanel {...props({ onOpenProduction })} />)
    fireEvent.click(screen.getByRole('button', { name: '进去挤奶' }))
    expect(onOpenProduction).toHaveBeenCalled()
  })

  it('没文章时六种拷打禁用，错题包围战仍可开', () => {
    render(<IntensivePanel {...props({ hasDoc: false })} />)
    expect((screen.getByRole('button', { name: '🥊 记忆拷打' }) as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByRole('button', { name: /错题包围战/ }) as HTMLButtonElement).disabled).toBe(false)
  })

  it('没有预习页的拷打各用自己的保存值；改数量后只记这个入口', () => {
    const onDrill = vi.fn()
    const onDrillLimitChange = vi.fn()
    const drillLimits = { ...DEFAULT_DRILL_LIMITS, deep: 20, grammar: 5 }
    const { rerender } = render(
      <IntensivePanel {...props({ onDrill, onDrillLimitChange, drillLimits })} />,
    )

    fireEvent.click(screen.getByRole('button', { name: '🇬🇧 英英释义' }))
    const deepSelect = screen.getByLabelText('英英释义每次题数') as HTMLSelectElement
    expect(deepSelect.value).toBe('20')
    fireEvent.change(deepSelect, { target: { value: '30' } })
    expect(onDrillLimitChange).toHaveBeenCalledWith('deep', 30)
    fireEvent.click(screen.getByRole('button', { name: '开始' }))
    expect(onDrill).toHaveBeenCalledWith('deep', 30)

    fireEvent.click(screen.getByRole('button', { name: '🧠 语法·结构' }))
    expect((screen.getByLabelText('语法·结构每次题数') as HTMLSelectElement).value).toBe('5')
    fireEvent.click(screen.getByRole('button', { name: '取消' }))
    expect(screen.queryByLabelText('语法·结构每次题数')).toBeNull()

    // 父层把新值存回来后，英英释义再次打开显示 30；语法·结构仍是 5。
    rerender(
      <IntensivePanel
        {...props({ onDrill, onDrillLimitChange, drillLimits: { ...drillLimits, deep: 30 } })}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: '🇬🇧 英英释义' }))
    expect((screen.getByLabelText('英英释义每次题数') as HTMLSelectElement).value).toBe('30')
    fireEvent.click(screen.getByRole('button', { name: '取消' }))
    fireEvent.click(screen.getByRole('button', { name: '🧠 语法·结构' }))
    expect((screen.getByLabelText('语法·结构每次题数') as HTMLSelectElement).value).toBe('5')
  })

  it('跑批中题数下拉和开始按钮也锁住（避免中途改设置）', () => {
    const { rerender } = render(<IntensivePanel {...props()} />)
    fireEvent.click(screen.getByRole('button', { name: '🇬🇧 英英释义' }))
    expect((screen.getByLabelText('英英释义每次题数') as HTMLSelectElement).disabled).toBe(false)

    rerender(<IntensivePanel {...props({ batchRunning: true })} />)
    expect((screen.getByLabelText('英英释义每次题数') as HTMLSelectElement).disabled).toBe(true)
    expect((screen.getByRole('button', { name: '开始' }) as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByRole('button', { name: '🇬🇧 英英释义' }) as HTMLButtonElement).disabled).toBe(true)
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

  it('关掉再打开：恢复同一篇文章的面板滚动位置', () => {
    const first = render(<IntensivePanel {...props({ scrollKey: 'same-article' })} />)
    const panel = first.container.querySelector('.plan-panel') as HTMLElement
    panel.scrollTop = 240
    first.unmount()

    const second = render(<IntensivePanel {...props({ scrollKey: 'same-article' })} />)
    expect((second.container.querySelector('.plan-panel') as HTMLElement).scrollTop).toBe(240)
    second.unmount()

    const other = render(<IntensivePanel {...props({ scrollKey: 'another-article' })} />)
    expect((other.container.querySelector('.plan-panel') as HTMLElement).scrollTop).toBe(0)
  })
})
