// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { DEFAULT_PRODUCTION_SETTINGS } from '../../core/production'
import type { WritingFeedback } from '../../core/writing'
import type { useProductionSession } from '../hooks/useProductionSession'
import ProductionPanel from './ProductionPanel'

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
    openProduction: noop,
    close: noop,
    stage: 'setup',
    settings: { ...DEFAULT_PRODUCTION_SETTINGS, topic: '工作沟通' },
    updateSettings: noop,
    start: noop,
    restart: noop,
    current: null,
    prompts: [],
    index: 0,
    answer: '',
    setAnswer: noop,
    feedback: null,
    previousFeedback: null,
    hits: [],
    round: 1,
    rewrite: noop,
    grade: noop,
    next: noop,
    generating: false,
    grading: false,
    error: '',
    pasteKind: '',
    applyPaste: noop,
    copyPromptAgain: noop,
    pendingPrompt: '',
    poolInfo: null,
    history: [],
    cancelRun: noop,
    ...over,
  } as unknown as ReturnType<typeof useProductionSession>
  return model
}

describe('ProductionPanel：奶牛工棚', () => {
  it('设置页显示主题 / 类型 / 数量；点开始走回调', () => {
    const start = vi.fn()
    const model = props({ start })
    render(<ProductionPanel model={model} />)
    expect(screen.getByText('🐄 D老师奶牛工棚')).toBeTruthy()
    expect((screen.getByLabelText('产出主题') as HTMLInputElement).value).toBe('工作沟通')
    expect(screen.getByLabelText('本轮题目数')).toBeTruthy()
    expect(screen.getByLabelText('每题目标块数')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '让 D老师出题' }))
    expect(start).toHaveBeenCalled()
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
    const { rerender } = render(<ProductionPanel model={model} />)
    expect(screen.getByText('目标块 1 个（答完再看具体是哪些）')).toBeTruthy()
    expect(screen.queryByText('follow up')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '批改这一稿' }))
    expect(grade).toHaveBeenCalled()

    rerender(
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

  it('第二稿后可以进下一题；完成页能再来一组', () => {
    const next = vi.fn()
    const restart = vi.fn()
    const current = {
      id: 'p1',
      zh: '说明进度',
      goal: '',
      targets: [{ id: 'v1', itemId: 'v1', kind: 'word' as const, text: 'follow up', meaning: '跟进' }],
    }
    const { rerender } = render(
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

    rerender(<ProductionPanel model={props({ stage: 'done', restart })} />)
    fireEvent.click(screen.getByRole('button', { name: '再来一组' }))
    expect(restart).toHaveBeenCalled()
  })
})
