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

/** 风味酸奶的断句编辑器：默认没拆过，用例要预览就塞 `pairs`。 */
function yogurtStub(over: Record<string, unknown> = {}) {
  const noop = vi.fn()
  return {
    pairs: null,
    setPairs: noop,
    warning: '',
    error: '',
    sessionPairs: [],
    preview: vi.fn(() => true),
    beginEdit: noop,
    updatePair: noop,
    movePair: noop,
    deletePair: noop,
    mergeNextPair: noop,
    splitPair: noop,
    addPair: noop,
    apply: vi.fn(() => true),
    reset: noop,
    ...over,
  }
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
    pause: noop,
    resume: noop,
    paused: false,
    savedDrafts: [],
    resumeSaved: noop,
    manualGrade: noop,
    yogurt: yogurtStub(),
    doneIds: new Set<string>(),
    jumpTo: noop,
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
    const yogurt = yogurtStub()
    const settings = {
      ...DEFAULT_PRODUCTION_SETTINGS,
      mode: 'yogurt' as const,
      sourceText: '你好。第二句。',
      referenceText: 'Hello. Second sentence.',
    }
    const model = props({ startYogurtPairs, updateSettings, yogurt, settings })
    const { rerender } = renderPanel(<ProductionPanel model={model} />)
    expect(screen.getByRole('button', { name: /全脂/ })).toBeTruthy()
    expect(screen.getByRole('button', { name: /脱脂奶/ })).toBeTruthy()
    expect(screen.getByRole('button', { name: /风味酸奶/ })).toBeTruthy()
    expect((screen.getByLabelText('风味酸奶原文') as HTMLTextAreaElement).value).toBe('你好。第二句。')
    expect((screen.getByLabelText('风味酸奶参考译文') as HTMLTextAreaElement).value).toBe('Hello. Second sentence.')
    expect(screen.queryByLabelText('产出主题')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '拆句预览' }))
    expect(yogurt.preview).toHaveBeenCalled()

    rerenderPanel(
      rerender,
      <ProductionPanel
        model={props({
          startYogurtPairs,
          updateSettings,
          settings,
          yogurt: yogurtStub({
            pairs: [
              { source: '你好。', reference: 'Hello.' },
              { source: '第二句。', reference: 'Second sentence.' },
            ],
          }),
        })}
      />,
    )
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
    // 退化成「复制提示词」时，粘回框要自动展开，别让人再点一次
    expect((screen.getByText('把 AI 返回的批改 JSON 粘到这里').closest('details') as HTMLDetailsElement).open).toBe(true)
  })

  it('暂停后回到工棚主界面：同一吃法才显示「继续」，点它接着原来那一题', () => {
    const resume = vi.fn()
    const first = { id: 'yogurt-1', zh: '你好。', goal: '', targets: [], reference: 'Hello.' }
    const second = { id: 'yogurt-2', zh: '第二句。', goal: '', targets: [], reference: 'Second.' }
    const model = props({
      stage: 'playing',
      sessionMode: 'yogurt',
      paused: true,
      index: 1,
      resume,
      current: second,
      prompts: [first, second],
      // 停在选草料屏时选中的就是风味酸奶
      settings: { ...DEFAULT_PRODUCTION_SETTINGS, mode: 'yogurt' },
      yogurt: yogurtStub({
        sessionPairs: [
          { source: '你好。', reference: 'Hello.' },
          { source: '第二句。', reference: 'Second.' },
        ],
      }),
    })
    renderPanel(<ProductionPanel model={model} />)
    expect(screen.getByText(/这一组已暂停：停在 2 \/ 2 题/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '继续这一组（第 2 题）' }))
    expect(resume).toHaveBeenCalled()
  })

  it('酸奶暂停着去切到脱脂奶：不许拿暂停那组冒充开始按钮，只给「切过去继续」', () => {
    const updateSettings = vi.fn()
    const first = { id: 'yogurt-1', zh: '你好。', goal: '', targets: [], reference: 'Hello.' }
    const model = props({
      stage: 'playing',
      sessionMode: 'yogurt',
      paused: true,
      index: 0,
      updateSettings,
      current: first,
      prompts: [first],
      settings: { ...DEFAULT_PRODUCTION_SETTINGS, mode: 'skim', topic: '工作沟通' },
    })
    renderPanel(<ProductionPanel model={model} />)
    // 主按钮是脱脂奶自己的开始，不是「继续这一组」
    expect(screen.getByRole('button', { name: '按主题出题' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: /继续这一组/ })).toBeNull()
    expect(screen.getByText(/「风味酸奶」那一组还暂停着/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '切过去继续' }))
    expect(updateSettings).toHaveBeenCalledWith({ mode: 'yogurt' })
  })

  it('别的吃法有草稿停着时，选草料屏给「继续这一组」把草稿接回来', () => {
    const resumeSaved = vi.fn()
    const draft = {
      version: 1 as const,
      sessionId: 's1',
      articleId: 'A',
      at: '2026-11-06T12:00:00.000Z',
      mode: 'yogurt' as const,
      sessionTopic: '风味酸奶',
      prompts: [{ id: 'yogurt-1', zh: '你好。', goal: '', targets: [] }],
      index: 0,
      answer: '',
      feedback: null,
      previousFeedback: null,
      hits: [],
      round: 1,
      notice: '',
    }
    renderPanel(
      <ProductionPanel
        model={props({
          settings: { ...DEFAULT_PRODUCTION_SETTINGS, mode: 'yogurt' },
          savedDrafts: [draft],
          resumeSaved,
        })}
      />,
    )
    expect(screen.getByText(/这里还停着一组：风味酸奶 · 第 1 \/ 1 题/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '继续这一组' }))
    expect(resumeSaved).toHaveBeenCalledWith(draft)
  })

  it('风味酸奶拷打页左侧常驻断句列表：点一句就做那一句，本句状态按已交集合算', () => {
    const beginEdit = vi.fn()
    const apply = vi.fn(() => true)
    const jumpTo = vi.fn()
    const prompts = [
      { id: 'yogurt-1', zh: '第一句。', goal: '', targets: [], reference: 'One.' },
      { id: 'yogurt-2', zh: '第二句。', goal: '', targets: [], reference: 'Two.' },
      { id: 'yogurt-3', zh: '第三句。', goal: '', targets: [], reference: 'Three.' },
    ]
    const pairs = [
      { source: '第一句。', reference: 'One.' },
      { source: '第二句。', reference: 'Two.' },
      { source: '第三句。', reference: 'Three.' },
    ]
    renderPanel(
      <ProductionPanel
        model={props({
          stage: 'playing',
          sessionMode: 'yogurt',
          index: 2,
          current: prompts[2],
          prompts,
          // 跳着做：只有第 1 句交过，第 2 句还是待做 —— 不能再用「在第几题之前」推断
          doneIds: new Set(['第一句。']),
          jumpTo,
          yogurt: yogurtStub({ beginEdit, apply, pairs, sessionPairs: pairs }),
        })}
      />,
    )
    expect(screen.getAllByText('已交')).toHaveLength(1)
    expect(screen.getAllByText('待做')).toHaveLength(1)
    expect(screen.getByText('当前')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /第一句/ }))
    expect(jumpTo).toHaveBeenCalledWith(0)
    fireEvent.click(screen.getByRole('button', { name: '改断句' }))
    expect(beginEdit).toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: '应用断句，继续这一题' }))
    expect(apply).toHaveBeenCalled()
  })

  it('风味酸奶开了整段连写时，列表末尾多一行「整段连写」也能点过去', () => {
    const jumpTo = vi.fn()
    const prompts = [
      { id: 'yogurt-1', zh: '第一句。', goal: '', targets: [], reference: 'One.' },
      { id: 'yogurt-paragraph', zh: '整段。', goal: '', targets: [], reference: 'Whole.' },
    ]
    const pairs = [{ source: '第一句。', reference: 'One.' }]
    renderPanel(
      <ProductionPanel
        model={props({
          stage: 'playing',
          sessionMode: 'yogurt',
          index: 0,
          current: prompts[0],
          prompts,
          doneIds: new Set<string>(),
          jumpTo,
          yogurt: yogurtStub({ pairs, sessionPairs: pairs }),
        })}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: /整段连写/ }))
    expect(jumpTo).toHaveBeenCalledWith(1)
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

  it('route.view=history 时进历史；返回回到工棚并 replace 掉 ph', () => {
    const onNavigate = vi.fn()
    render(
      <MemoryRouter>
        <ProductionPanel model={props()} route={{ view: 'history' }} onNavigate={onNavigate} />
      </MemoryRouter>,
    )
    expect(screen.getByText('产出历史')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '← 返回工棚' }))
    expect(onNavigate).toHaveBeenCalledWith({ view: undefined }, { replace: true })
  })

  it('点历史按钮 push 到 ?ph=1', () => {
    const onNavigate = vi.fn()
    render(
      <MemoryRouter>
        <ProductionPanel model={props()} route={{ mode: 'skim' }} onNavigate={onNavigate} />
      </MemoryRouter>,
    )
    fireEvent.click(screen.getByRole('button', { name: '历史' }))
    expect(onNavigate).toHaveBeenCalledWith({ mode: 'skim', view: 'history' })
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
