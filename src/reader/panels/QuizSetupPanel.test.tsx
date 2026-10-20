// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import QuizSetupPanel, { type QuizSetupPanelProps } from './QuizSetupPanel'

function props(over: Partial<QuizSetupPanelProps> = {}): QuizSetupPanelProps {
  const noop = vi.fn()
  return {
    kinds: ['spell', 'cloze'],
    scope: 'unmastered',
    limit: 20,
    auto: true,
    unique: false,
    speakAfter: false,
    loopWrong: true,
    availableCount: 12,
    poolUnmastered: 8,
    articleKinds: ['translate'],
    articleAvailable: 5,
    onToggleKind: noop,
    onToggleArticleKind: noop,
    onScopeChange: noop,
    onLimitChange: noop,
    onAutoChange: noop,
    onUniqueChange: noop,
    onSpeakChange: noop,
    onLoopWrongChange: noop,
    onCancel: noop,
    onStart: noop,
    onStartArticle: noop,
    ...over,
  }
}

describe('QuizSetupPanel：词级考试设置', () => {
  it('题型勾选状态与切换回调', () => {
    const onToggleKind = vi.fn()
    render(<QuizSetupPanel {...props({ onToggleKind })} />)
    const spell = screen.getByLabelText('拼写') as HTMLInputElement
    const choice = screen.getByLabelText('词形辨析') as HTMLInputElement
    expect(spell.checked).toBe(true)
    expect(choice.checked).toBe(false)

    fireEvent.click(choice)
    expect(onToggleKind).toHaveBeenCalledWith('choice', true)
    fireEvent.click(spell)
    expect(onToggleKind).toHaveBeenCalledWith('spell', false)
  })

  it('范围/题量下拉回调', () => {
    const onScopeChange = vi.fn()
    const onLimitChange = vi.fn()
    render(<QuizSetupPanel {...props({ onScopeChange, onLimitChange })} />)
    fireEvent.change(screen.getByDisplayValue('未掌握'), { target: { value: 'all' } })
    expect(onScopeChange).toHaveBeenCalledWith('all')
    fireEvent.change(screen.getByDisplayValue('20 题'), { target: { value: '0' } })
    expect(onLimitChange).toHaveBeenCalledWith(0)
  })

  it('答题开关全部走回调', () => {
    const onAutoChange = vi.fn()
    const onUniqueChange = vi.fn()
    const onSpeakChange = vi.fn()
    const onLoopWrongChange = vi.fn()
    render(
      <QuizSetupPanel
        {...props({ onAutoChange, onUniqueChange, onSpeakChange, onLoopWrongChange })}
      />,
    )
    fireEvent.click(screen.getByLabelText('自动下一题'))
    fireEvent.click(screen.getByLabelText('每词一题 · 乱序'))
    fireEvent.click(screen.getByLabelText('答完朗读'))
    fireEvent.click(screen.getByLabelText('🔁 反复鞭打错题'))
    expect(onAutoChange).toHaveBeenCalledWith(false)
    expect(onUniqueChange).toHaveBeenCalledWith(true)
    expect(onSpeakChange).toHaveBeenCalledWith(true)
    expect(onLoopWrongChange).toHaveBeenCalledWith(false)
  })

  it('显示范围与可出题数；没选题型不能开始', () => {
    const onStart = vi.fn()
    const { rerender } = render(<QuizSetupPanel {...props({ onStart })} />)
    expect(document.querySelector('p.muted')?.textContent).toContain('本次范围：未掌握 · 可出 12 题（未掌握约 8 题）')
    fireEvent.click(screen.getByRole('button', { name: '开始考试' }))
    expect(onStart).toHaveBeenCalled()

    rerender(<QuizSetupPanel {...props({ kinds: [] })} />)
    expect((screen.getByRole('button', { name: '开始考试' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('取消回调', () => {
    const onCancel = vi.fn()
    render(<QuizSetupPanel {...props({ onCancel })} />)
    fireEvent.click(screen.getByRole('button', { name: '取消' }))
    expect(onCancel).toHaveBeenCalled()
  })
})

describe('QuizSetupPanel：文章测验', () => {
  it('文章题型切换；按钮显示预计题数并可开始', () => {
    const onToggleArticleKind = vi.fn()
    const onStartArticle = vi.fn()
    const { rerender } = render(
      <QuizSetupPanel {...props({ onToggleArticleKind, onStartArticle })} />,
    )
    fireEvent.click(screen.getByLabelText('英译中'))
    expect(onToggleArticleKind).toHaveBeenCalledWith('translate', false)

    fireEvent.click(screen.getByRole('button', { name: '开始文章测验（约 5 题）' }))
    expect(onStartArticle).toHaveBeenCalled()

    rerender(<QuizSetupPanel {...props({ articleAvailable: 0 })} />)
    const btn = screen.getByRole('button', { name: '开始文章测验' }) as HTMLButtonElement
    expect(btn.disabled).toBe(true)
  })

  it('没选文章题型 / 没可出题时不能开始', () => {
    render(<QuizSetupPanel {...props({ articleKinds: [], articleAvailable: 3 })} />)
    expect((screen.getByRole('button', { name: '开始文章测验（约 3 题）' }) as HTMLButtonElement).disabled).toBe(true)
  })
})
