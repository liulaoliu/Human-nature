// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import SidePick, { type SidePickProps } from './SidePick'

function props(over: Partial<SidePickProps> = {}): SidePickProps {
  const noop = vi.fn()
  return {
    tasks: [
      { task: 'translate', label: '翻译' },
      { task: 'lookup', label: '查词' },
    ] as never,
    onPrompt: noop,
    lastTask: null,
    target: 'Run fast.',
    useExact: true,
    vocabMode: false,
    canMark: true,
    visibleBatch: [],
    batchCount: 0,
    onRemoveWord: noop,
    onCommitBatch: noop,
    onCopyBatchPrompt: noop,
    onExportBatch: noop,
    onClearBatch: noop,
    onAddSelectionToBatch: noop,
    onMark: noop,
    onOpenLang: noop,
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
    dictReady: true,
    onPickFromDict: noop,
    onEnrichFromDict: noop,
    onFixLemmasFromDict: noop,
    onConfuseFromDict: noop,
    onEnrichExamples: noop,
    examplesReady: true,
    aiFileRef: { current: null },
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
    confusableBatchCount: 0,
    confusableTodoCount: 0,
    onCopyConfusable: noop,
    confusableBatchSize: 30,
    onConfusableBatchSizeChange: noop,
    lemmaCount: 0,
    onCopyLemma: noop,
    posCount: 0,
    onCopyPos: noop,
    hasItems: false,
    onDedupe: noop,
    ...over,
  }
}

afterEach(() => vi.restoreAllMocks())

describe('SidePick：待选区', () => {
  it('没有待选时不渲染待选区；有则显示词与按钮禁用逻辑', () => {
    const { rerender } = render(<SidePick {...props()} />)
    expect(screen.queryByText(/待选 0/)).toBeNull()

    rerender(<SidePick {...props({ batchCount: 2 })} />)
    // 两个都入库了：只提示，不显示 chips
    expect(screen.getAllByText(/都已在生词本里/).length).toBeGreaterThan(0)
    expect((screen.getByRole('button', { name: '加入生词本' }) as HTMLButtonElement).disabled).toBe(true)

    rerender(
      <SidePick
        {...props({
          batchCount: 2,
          visibleBatch: [{ word: 'run', sentence: 'Run fast.', sentenceId: 's1' }],
        })}
      />,
    )
    expect(screen.getByRole('button', { name: 'run ×' })).toBeTruthy()
    expect((screen.getByRole('button', { name: '加入生词本' }) as HTMLButtonElement).disabled).toBe(false)
  })

  it('点词移除 + 清空 + 导出 CSV 都走回调', () => {
    const onRemoveWord = vi.fn()
    const onClearBatch = vi.fn()
    const onExportBatch = vi.fn()
    render(
      <SidePick
        {...props({
          batchCount: 1,
          visibleBatch: [{ word: 'run', sentence: 'Run fast.', sentenceId: 's1' }],
          onRemoveWord,
          onClearBatch,
          onExportBatch,
        })}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'run ×' }))
    expect(onRemoveWord).toHaveBeenCalledWith(expect.objectContaining({ word: 'run' }))
    fireEvent.click(screen.getByRole('button', { name: '清空' }))
    expect(onClearBatch).toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: '导出 CSV' }))
    expect(onExportBatch).toHaveBeenCalled()
  })
})

describe('SidePick：选区任务与粘回', () => {
  it('选区为空时加入待选/直接入库不可点；有选区时点击回调', () => {
    const onAddSelectionToBatch = vi.fn()
    const onMark = vi.fn()
    const { rerender } = render(
      <SidePick {...props({ canMark: false, onAddSelectionToBatch, onMark })} />,
    )
    expect((screen.getByRole('button', { name: '加入待选' }) as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByRole('button', { name: '直接入库（未查词）' }) as HTMLButtonElement).disabled).toBe(true)

    rerender(<SidePick {...props({ onAddSelectionToBatch, onMark })} />)
    fireEvent.click(screen.getByRole('button', { name: '加入待选' }))
    fireEvent.click(screen.getByRole('button', { name: '直接入库（未查词）' }))
    expect(onAddSelectionToBatch).toHaveBeenCalled()
    expect(onMark).toHaveBeenCalled()
  })

  it('任务按钮把 task 交给 onPrompt；语言点按钮受选区控制', () => {
    const onPrompt = vi.fn()
    const onOpenLang = vi.fn()
    const { rerender } = render(<SidePick {...props({ onPrompt, onOpenLang })} />)
    fireEvent.click(screen.getByRole('button', { name: '翻译' }))
    expect(onPrompt).toHaveBeenCalledWith('translate')

    rerender(<SidePick {...props({ target: '', onPrompt, onOpenLang })} />)
    expect((screen.getByRole('button', { name: '＋ 语言点' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('粘贴框受控；应用/重发缺项按状态启用', () => {
    const onPastedChange = vi.fn()
    const onApplyPaste = vi.fn()
    const onCopyMissingAgain = vi.fn()
    const { rerender } = render(
      <SidePick {...props({ onPastedChange, onApplyPaste, onCopyMissingAgain })} />,
    )
    fireEvent.change(screen.getByPlaceholderText(/把 DeepSeek 的结果粘回/), { target: { value: 'x' } })
    expect(onPastedChange).toHaveBeenCalledWith('x')
    expect((screen.getByRole('button', { name: '应用结果' }) as HTMLButtonElement).disabled).toBe(true)

    rerender(
      <SidePick
        {...props({ pasted: 'result', pasteMissingCount: 2, onApplyPaste, onCopyMissingAgain })}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: '应用结果' }))
    expect(onApplyPaste).toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: /复制未返回的 2 个/ }))
    expect(onCopyMissingAgain).toHaveBeenCalled()
  })
})

describe('SidePick：一键跑批与进度', () => {
  it('没有待办 / 未配 key 时跑批按钮禁用并给出原因', () => {
    const { rerender } = render(<SidePick {...props()} />)
    expect((screen.getByRole('button', { name: /一键跑批（0 项）/ }) as HTMLButtonElement).disabled).toBe(true)

    rerender(<SidePick {...props({ webPending: 3, localConfigured: false })} />)
    expect((screen.getByRole('button', { name: /一键跑批（3 项）/ }) as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getByText(/未配置 key/)).toBeTruthy()
  })

  it('跑批中显示轮次进度；错误可见', () => {
    render(
      <SidePick
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

  it('范围切换与自动标词开关回调', () => {
    const onAiScopeChange = vi.fn()
    const { rerender } = render(<SidePick {...props({ onAiScopeChange })} />)
    fireEvent.click(screen.getByRole('button', { name: '全库' }))
    expect(onAiScopeChange).toHaveBeenCalledWith('all')

    // 范围由父层控制：切到 all 后出现警告
    rerender(<SidePick {...props({ onAiScopeChange, aiScope: 'all' })} />)
    expect(screen.getByText(/全库范围/)).toBeTruthy()
  })

  it('待办清单按完成状态渲染；跳过需确认', () => {
    const onSkipPending = vi.fn()
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true)
    render(
      <SidePick
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
    render(<SidePick {...props({ webTotal: 3, onRefreshWeb })} />)
    fireEvent.click(screen.getByRole('button', { name: /重置进度/ }))
    expect(onRefreshWeb).not.toHaveBeenCalled()
  })
})
