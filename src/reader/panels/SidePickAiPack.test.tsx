// @vitest-environment jsdom
import { createRef } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import SidePickAiPack, { type SidePickAiPackProps } from './SidePickAiPack'

function props(over: Partial<SidePickAiPackProps> = {}): SidePickAiPackProps {
  const noop = vi.fn()
  return {
    pasted: '',
    onPastedChange: noop,
    pasteReport: [],
    pasteMissingCount: 0,
    onApplyPaste: noop,
    onCopyMissingAgain: noop,
    aiJobCount: 0,
    aiScope: 'article',
    onAiScopeChange: noop,
    autoVocabDirect: false,
    onAutoVocabDirectChange: noop,
    autoVocabDoneHere: false,
    onRerunAutoVocab: noop,
    onExportAiJobs: noop,
    aiFileRef: createRef<HTMLInputElement>(),
    onAiFile: noop,
    localConfigured: true,
    localRunning: false,
    localDone: 0,
    localTotal: 0,
    localRound: 0,
    localPhase: '',
    localError: '',
    onRunLocal: noop,
    checklist: [],
    checklistDone: 0,
    checklistTotal: 0,
    nextHint: '',
    onSkipPending: noop,
    aiWebBatchSize: 6,
    onAiWebBatchSizeChange: noop,
    onCopyWebPrompt: noop,
    onCopyWebMissing: noop,
    onRefreshWeb: noop,
    webTotal: 0,
    webDone: 0,
    webPending: 0,
    webMissing: 0,
    webPendingLabels: [],
    webBreakdown: [],
    ...over,
  }
}

afterEach(() => vi.restoreAllMocks())

describe('SidePickAiPack：粘回与应用', () => {
  it('粘贴框受控；应用/重发缺项按状态启用', () => {
    const onPastedChange = vi.fn()
    const onApplyPaste = vi.fn()
    const onCopyMissingAgain = vi.fn()
    const { rerender } = render(
      <SidePickAiPack {...props({ onPastedChange, onApplyPaste, onCopyMissingAgain })} />,
    )
    fireEvent.change(screen.getByPlaceholderText(/把 DeepSeek 的结果粘回/), { target: { value: 'x' } })
    expect(onPastedChange).toHaveBeenCalledWith('x')
    expect((screen.getByRole('button', { name: '应用结果' }) as HTMLButtonElement).disabled).toBe(true)

    rerender(
      <SidePickAiPack
        {...props({ pasted: 'result', pasteMissingCount: 2, onApplyPaste, onCopyMissingAgain })}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: '应用结果' }))
    expect(onApplyPaste).toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: /复制未返回的 2 个/ }))
    expect(onCopyMissingAgain).toHaveBeenCalled()
  })
})

describe('SidePickAiPack：跑批与进度', () => {
  it('没有待办 / 未配 key 时禁用并说明原因；跑批中显示轮次', () => {
    const { rerender } = render(<SidePickAiPack {...props()} />)
    expect((screen.getByRole('button', { name: /一键跑批（0 项）/ }) as HTMLButtonElement).disabled).toBe(true)

    rerender(<SidePickAiPack {...props({ webPending: 3, localConfigured: false })} />)
    expect((screen.getByRole('button', { name: /一键跑批（3 项）/ }) as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getByText(/未配置 key/)).toBeTruthy()

    rerender(
      <SidePickAiPack
        {...props({
          webPending: 3,
          localRunning: true,
          localRound: 2,
          localPhase: '查词',
          localDone: 1,
          localTotal: 3,
          localError: '与服务端失联',
        })}
      />,
    )
    expect(screen.getByRole('button', { name: /第 2 轮 · 查词 1\/3/ })).toBeTruthy()
    expect(screen.getByText(/与服务端失联/)).toBeTruthy()
  })

  it('待办清单按完成状态渲染；跳过需确认', () => {
    const onSkipPending = vi.fn()
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true)
    render(
      <SidePickAiPack
        {...props({
          webPending: 2,
          checklist: [
            { key: 'a', label: '自动标词', done: 1, total: 1 },
            { key: 'b', label: '查词', done: 0, total: 2 },
          ],
          checklistDone: 1,
          checklistTotal: 2,
          nextHint: '先补查词',
          onSkipPending,
        })}
      />,
    )
    expect(screen.getByText('自动标词')).toBeTruthy()
    expect(screen.getByText(/先补查词/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /跳过这 2 项/ }))
    expect(confirmSpy).toHaveBeenCalled()
    expect(onSkipPending).toHaveBeenCalled()
  })

  it('重置进度需确认；取消时不回调', () => {
    const onRefreshWeb = vi.fn()
    vi.spyOn(window, 'confirm').mockReturnValue(false)
    render(<SidePickAiPack {...props({ webTotal: 3, onRefreshWeb })} />)
    fireEvent.click(screen.getByRole('button', { name: /重置进度/ }))
    expect(onRefreshWeb).not.toHaveBeenCalled()
  })
})

describe('SidePickAiPack：范围与工作包', () => {
  it('全库范围给警告；自动标词开关与重跑走回调', () => {
    const onAiScopeChange = vi.fn()
    const onAutoVocabDirectChange = vi.fn()
    const onRerunAutoVocab = vi.fn()
    const { rerender } = render(
      <SidePickAiPack {...props({ onAiScopeChange, onAutoVocabDirectChange, onRerunAutoVocab })} />,
    )
    fireEvent.click(screen.getByRole('button', { name: '全库' }))
    expect(onAiScopeChange).toHaveBeenCalledWith('all')

    rerender(
      <SidePickAiPack
        {...props({ aiScope: 'all', autoVocabDoneHere: true, onAutoVocabDirectChange, onRerunAutoVocab })}
      />,
    )
    expect(screen.getByText(/全库范围/)).toBeTruthy()
    fireEvent.click(screen.getByRole('checkbox'))
    expect(onAutoVocabDirectChange).toHaveBeenCalledWith(true)
    fireEvent.click(screen.getByRole('button', { name: /重跑自动标词/ }))
    expect(onRerunAutoVocab).toHaveBeenCalled()
  })

  it('没有待办时导出禁用；有则回调节数', () => {
    const onExportAiJobs = vi.fn()
    const { rerender } = render(<SidePickAiPack {...props({ onExportAiJobs })} />)
    expect((screen.getByRole('button', { name: /导出 AI 工作包/ }) as HTMLButtonElement).disabled).toBe(true)

    rerender(<SidePickAiPack {...props({ aiJobCount: 4, onExportAiJobs })} />)
    fireEvent.click(screen.getByRole('button', { name: /导出 AI 工作包（4 项）/ }))
    expect(onExportAiJobs).toHaveBeenCalled()
  })
})
