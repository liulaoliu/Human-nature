// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { DEFAULT_PRODUCTION_SETTINGS } from '../../core/production'
import type { WritingFeedback } from '../../core/writing'
import type { useProductionSession } from '../hooks/useProductionSession'
import ProductionPanel from './ProductionPanel'

function renderPanel(ui: React.ReactElement) {
  return render(<MemoryRouter>{ui}</MemoryRouter>)
}

function rerenderPanel(rerender: (ui: React.ReactElement) => void, ui: React.ReactElement) {
  rerender(<MemoryRouter>{ui}</MemoryRouter>)
}

const feedback: WritingFeedback = {
  version: 2,
  scores: [{ dimension: '意思到位', score: 40, max: 40 }],
  total: 40,
  max: 40,
  issues: [],
  polished: 'I will follow up.',
  summary: '可以。',
}

function props(over: Partial<ReturnType<typeof useProductionSession>> = {}) {
  const noop = vi.fn()
  const model = {
    open: true,
    articleTitle: 'A',
    articleIdentity: 'A',
    sessionMode: 'skim',
    openProduction: noop,
    close: noop,
    stage: 'setup',
    settings: { ...DEFAULT_PRODUCTION_SETTINGS, mode: 'skim', topic: '工作沟通' },
    updateSettings: noop,
    start: noop,
    startYogurtPairs: noop,
    restart: noop,
    current: null,
    prompts: [],
    index: 0,
    answer: '',
    setAnswer: noop,
    feedback: null,
    previousFeedback: null,
    hits: [],
    setHitUsed: noop,
    round: 1,
    rewrite: noop,
    grade: noop,
    next: noop,
    skip: noop,
    generating: false,
    grading: false,
    error: '',
    notice: '',
    pasteKind: '',
    applyPaste: noop,
    copyPromptAgain: noop,
    pendingPrompt: '',
    poolInfo: null,
    history: [],
    allHistory: [],
    progress: [],
    stats: {
      attempts: 0,
      sessions: 0,
      rewrites: 0,
      modes: {},
      targetAttempts: 0,
      targetHits: 0,
      targetMisses: 0,
      hitRate: 0,
      avgScore: 0,
    },
    sessionId: 's1',
    followUp: { items: [], asking: false, error: '', ask: noop },
    cancelRun: noop,
    ...over,
  } as unknown as ReturnType<typeof useProductionSession>
  return model
}

describe('ProductionPanel：奶牛工棚', () => {
  it('全脂不显示主题，显示目标块配置；点开始走回调', () => {
    const start = vi.fn()
    const model = props({
      start,
      settings: { ...DEFAULT_PRODUCTION_SETTINGS, mode: 'full' },
    })
    renderPanel(<ProductionPanel model={model} />)
    expect(screen.getByText('🐄 D老师奶牛工棚')).toBeTruthy()
    expect(screen.queryByLabelText('产出主题')).toBeNull()
    expect(screen.getByLabelText('本轮题目数')).toBeTruthy()
    expect(screen.getByLabelText('每题目标块数')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '全脂随机出题' }))
    expect(start).toHaveBeenCalled()
  })

  it('脱脂奶显示主题，不要求目标块', () => {
    const start = vi.fn()
    const model = props({
      start,
      settings: { ...DEFAULT_PRODUCTION_SETTINGS, mode: 'skim', topic: '工作沟通' },
    })
    renderPanel(<ProductionPanel model={model} />)
    expect((screen.getByLabelText('产出主题') as HTMLInputElement).value).toBe('工作沟通')
    expect(screen.queryByLabelText('每题目标块数')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '按主题出题' }))
    expect(start).toHaveBeenCalled()
  })

  it('全脂可关本机词块；脱脂奶可开本机词块', () => {
    const { rerender } = renderPanel(
      <ProductionPanel
        model={props({
          settings: { ...DEFAULT_PRODUCTION_SETTINGS, mode: 'full', fullUseChunks: false },
        })}
      />,
    )
    expect(screen.queryByLabelText('每题目标块数')).toBeNull()

    rerenderPanel(rerender,
      <ProductionPanel
        model={props({
          settings: {
            ...DEFAULT_PRODUCTION_SETTINGS,
            mode: 'skim',
            topic: '工作沟通',
            skimUseChunks: true,
          },
        })}
      />,
    )
    expect(screen.getByLabelText('每题目标块数')).toBeTruthy()
  })

  it('三种模式可切；风味酸奶先拆句预览，再开始逐句', () => {
    const updateSettings = vi.fn()
    const startYogurtPairs = vi.fn()
    const model = props({
      startYogurtPairs,
      updateSettings,
      settings: {
        ...DEFAULT_PRODUCTION_SETTINGS,
        mode: 'yogurt',
        sourceText: '你好。第二句。',
        referenceText: 'Hello. Second sentence.',
      },
    })
    renderPanel(<ProductionPanel model={model} />)
    expect(screen.getByRole('button', { name: /全脂/ })).toBeTruthy()
    expect(screen.getByRole('button', { name: /脱脂奶/ })).toBeTruthy()
    expect(screen.getByRole('button', { name: /风味酸奶/ })).toBeTruthy()
    expect((screen.getByLabelText('风味酸奶原文') as HTMLTextAreaElement).value).toBe('你好。第二句。')
    expect((screen.getByLabelText('风味酸奶参考译文') as HTMLTextAreaElement).value).toBe('Hello. Second sentence.')
    expect(screen.queryByLabelText('产出主题')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '拆句预览' }))
    expect(screen.getByLabelText('第1对原文')).toBeTruthy()
    expect(screen.getByLabelText('第2对参考译文')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '开始逐句拷打' }))
    expect(startYogurtPairs).toHaveBeenCalled()
  })

  it('答题页先不暴露英文目标块；提交后显示目标和重写入口', () => {
    const grade = vi.fn()
    const rewrite = vi.fn()
    const model = props({
      stage: 'playing',
      current: {
        id: 'p1',
        zh: '跟同事说明你下午会跟进。',
        goal: '说明进度',
        targets: [{ id: 'v1', itemId: 'v1', kind: 'word', text: 'follow up', meaning: '跟进' }],
      },
      prompts: [{ id: 'p1', zh: '跟同事说明你下午会跟进。', goal: '说明进度', targets: [] }],
      answer: 'I will follow up this afternoon.',
      grade,
      rewrite,
    })
    const { rerender } = renderPanel(<ProductionPanel model={model} />)
    expect(screen.getByText('目标块 1 个（答完再看具体是哪些）')).toBeTruthy()
    expect(screen.queryByText('follow up')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '批改这一稿' }))
    expect(grade).toHaveBeenCalled()

    rerenderPanel(rerender,
      <ProductionPanel
        model={props({
          ...model,
          feedback,
          hits: [{ id: 'v1', kind: 'word', text: 'follow up', meaning: '跟进', used: true }],
          rewrite,
        })}
      />,
    )
    expect(screen.getByText(/follow up：用上了/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '按批改意见重写一版' }))
    expect(rewrite).toHaveBeenCalled()
  })

  it('风味酸奶没配 AI 时，批改粘回框仍然显示', () => {
    const current = {
      id: 'yogurt-1',
      zh: '你好。',
      goal: '逐句翻译',
      targets: [],
      reference: 'Hello.',
    }
    renderPanel(
      <ProductionPanel
        model={props({
          stage: 'playing',
          settings: { ...DEFAULT_PRODUCTION_SETTINGS, mode: 'yogurt' },
          current,
          prompts: [current],
          pasteKind: 'feedback',
          pendingPrompt: 'grade prompt',
        })}
      />,
    )
    expect(screen.getByText('把 AI 返回的批改 JSON 粘到这里')).toBeTruthy()
  })

  it('挖空 / 词序题型是真交互：填格或点词都会改答案', () => {
    const setAnswer = vi.fn()
    const current = {
      id: 'p1',
      zh: '说明进度',
      goal: '',
      targets: [{ id: 'v1', itemId: 'v1', kind: 'word' as const, text: 'follow up', meaning: '跟进' }],
      model: 'I will follow up today.',
    }
    const { rerender } = renderPanel(
      <ProductionPanel
        model={props({
          stage: 'playing',
          settings: { ...DEFAULT_PRODUCTION_SETTINGS, variant: 'cloze' },
          current,
          prompts: [current],
          answer: '',
          setAnswer,
        })}
      />,
    )
    fireEvent.change(screen.getByLabelText('第1空'), { target: { value: 'follow up' } })
    expect(setAnswer).toHaveBeenCalledWith('I will follow up today.')

    setAnswer.mockClear()
    rerenderPanel(
      rerender,
      <ProductionPanel
        model={props({
          stage: 'playing',
          settings: { ...DEFAULT_PRODUCTION_SETTINGS, variant: 'reorder' },
          current,
          prompts: [current],
          answer: '',
          setAnswer,
        })}
      />,
    )
    fireEvent.click(screen.getAllByRole('button', { name: /will|follow|today|I/ })[0])
    expect(setAnswer).toHaveBeenCalled()
  })

  it('历史视图可用 ?ph=1 深链接；返回回到选草料', () => {
    render(
      <MemoryRouter initialEntries={['/reader/p/production?ph=1']}>
        <ProductionPanel model={props()} />
      </MemoryRouter>,
    )
    expect(screen.getByText('产出历史')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '← 返回工棚' }))
    expect(screen.getByText('🐄 D老师奶牛工棚')).toBeTruthy()
  })

  it('第二稿后可以进下一题；完成页能再来一组', () => {
    const next = vi.fn()
    const restart = vi.fn()
    const current = {
      id: 'p1',
      zh: '说明进度',
      goal: '',
      targets: [{ id: 'v1', itemId: 'v1', kind: 'word' as const, text: 'follow up', meaning: '跟进' }],
    }
    const { rerender } = renderPanel(
      <ProductionPanel
        model={props({
          stage: 'playing',
          current,
          prompts: [current],
          feedback,
          round: 2,
          next,
        })}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: '下一题' }))
    expect(next).toHaveBeenCalled()

    rerenderPanel(rerender, <ProductionPanel model={props({ stage: 'done', restart })} />)
    fireEvent.click(screen.getByRole('button', { name: '再来一组' }))
    expect(restart).toHaveBeenCalled()
  })
})
