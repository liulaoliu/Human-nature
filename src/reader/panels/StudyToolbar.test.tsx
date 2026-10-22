// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import StudyToolbar, { type StudyToolbarProps } from './StudyToolbar'

function props(over: Partial<StudyToolbarProps> = {}): StudyToolbarProps {
  const noop = vi.fn()
  return {
    index: 0,
    queueLength: 3,
    roundTotal: 3,
    extraCount: 0,
    mode: 'learn',
    deck: 'word',
    scope: 'unmastered',
    newLimit: 20,
    newToday: 5,
    dueCount: 4,
    newCount: 7,
    spelling: false,
    drillAfter: 60,
    groupSize: 0,
    onGroupSizeChange: noop,
    cardSeconds: 12,
    liveSeconds: 65,
    grandSeconds: 3600,
    heat: 1,
    onClose: noop,
    onBack: noop,
    onNext: noop,
    onExam: noop,
    onSwitchMode: noop,
    onSwitchDeck: noop,
    onSwitchScope: noop,
    onStartArticleAll: noop,
    onNewLimitChange: noop,
    onDrillAfterChange: noop,
    onSpellingChange: noop,
    ...over,
  }
}

describe('StudyToolbar：顶栏接线', () => {
  it('进度/新词配额/时长可见；首张卡禁用「上一个」', () => {
    render(<StudyToolbar {...props()} />)
    expect(screen.getByText(/1 \/ 3/)).toBeTruthy()
    expect(screen.getByText(/新词 5\/20/)).toBeTruthy()
    expect(screen.getByText(/本轮 1:05/)).toBeTruthy()
    expect((screen.getByRole('button', { name: /上一个/ }) as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByRole('button', { name: /下一个/ }) as HTMLButtonElement).disabled).toBe(false)
  })

  it('模式/牌组/范围/配额/拼写/锤炼都走回调', () => {
    const onSwitchMode = vi.fn()
    const onSwitchDeck = vi.fn()
    const onSwitchScope = vi.fn()
    const onNewLimitChange = vi.fn()
    const onSpellingChange = vi.fn()
    const onDrillAfterChange = vi.fn()
    const onStartArticleAll = vi.fn()
    render(
      <StudyToolbar
        {...props({ onSwitchMode, onSwitchDeck, onSwitchScope, onNewLimitChange, onSpellingChange, onDrillAfterChange, onStartArticleAll })}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: /^复习/ }))
    expect(onSwitchMode).toHaveBeenCalledWith('review')
    fireEvent.click(screen.getByRole('button', { name: '背搭配' }))
    expect(onSwitchDeck).toHaveBeenCalledWith('collocation')
    fireEvent.change(screen.getByDisplayValue('未掌握'), { target: { value: 'lapses' } })
    expect(onSwitchScope).toHaveBeenCalledWith('lapses')
    fireEvent.click(screen.getByRole('button', { name: '本篇全部' }))
    expect(onStartArticleAll).toHaveBeenCalled()
    fireEvent.change(screen.getByDisplayValue('新词 20/天'), { target: { value: '30' } })
    expect(onNewLimitChange).toHaveBeenCalledWith(30)
    fireEvent.click(screen.getByLabelText('拼写'))
    expect(onSpellingChange).toHaveBeenCalledWith(true)
    fireEvent.change(screen.getByDisplayValue('60s 锤炼'), { target: { value: '0' } })
    expect(onDrillAfterChange).toHaveBeenCalledWith(0)
  })

  it('加练与末张卡的边界文案', () => {
    render(<StudyToolbar {...props({ index: 3, queueLength: 3, extraCount: 2, mode: 'review' })} />)
    expect(screen.getByText(/加练 ×2/)).toBeTruthy()
    expect((screen.getByRole('button', { name: /下一个/ }) as HTMLButtonElement).disabled).toBe(true)
    expect(screen.queryByText(/新词 5\/20/)).toBeNull()
  })
})
