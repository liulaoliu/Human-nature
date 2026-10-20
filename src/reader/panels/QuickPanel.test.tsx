// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { vocabItem } from '../../core/testFixtures'
import QuickPanel, { type QuickPanelProps } from './QuickPanel'

function props(over: Partial<QuickPanelProps> = {}): QuickPanelProps {
  const noop = vi.fn()
  return {
    current: vocabItem({ word: 'run', phonetic: '/rʌn/', partOfSpeech: 'v.', meaning: '跑', usage: ['run fast'] }),
    queueLength: 3,
    index: 0,
    revealed: false,
    onClose: noop,
    onReveal: noop,
    onSpeak: noop,
    onGrade: noop,
    onRestart: noop,
    ...over,
  }
}

describe('QuickPanel', () => {
  it('显示进度与当前词；未揭示时不显示释义', () => {
    render(<QuickPanel {...props()} />)
    expect(screen.getByText('1 / 3')).toBeTruthy()
    expect(screen.getByText('run')).toBeTruthy()
    expect(screen.queryByText('跑')).toBeNull()
    expect(screen.getByText('空格 / 点击 = 看释义')).toBeTruthy()
  })

  it('点卡片揭示；朗读按钮不冒泡触发揭示', () => {
    const onReveal = vi.fn()
    const onSpeak = vi.fn()
    render(<QuickPanel {...props({ onReveal, onSpeak })} />)
    fireEvent.click(screen.getByRole('button', { name: '朗读' }))
    expect(onSpeak).toHaveBeenCalledWith('run')
    expect(onReveal).not.toHaveBeenCalled()

    fireEvent.click(screen.getByText('run'))
    expect(onReveal).toHaveBeenCalled()
  })

  it('揭示后显示词性/释义/用法，评分按钮回调', () => {
    const onGrade = vi.fn()
    render(<QuickPanel {...props({ revealed: true, onGrade })} />)
    expect(screen.getByText('跑')).toBeTruthy()
    expect(screen.getByText('run fast')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /不认识/ }))
    fireEvent.click(screen.getByRole('button', { name: /^认识/ }))
    expect(onGrade.mock.calls.map((c) => c[0])).toEqual([false, true])
  })

  it('没有当前词：显示结算与重开/退出', () => {
    const onRestart = vi.fn()
    const onClose = vi.fn()
    render(<QuickPanel {...props({ current: null, queueLength: 3, onRestart, onClose })} />)
    expect(screen.getByText('快刷完成，共 3 个词。')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '再来一轮' }))
    expect(onRestart).toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: '回到阅读' }))
    expect(onClose).toHaveBeenCalled()
  })
})
