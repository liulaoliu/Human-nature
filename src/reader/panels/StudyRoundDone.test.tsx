// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import StudyRoundDone, { type StudyRoundDoneProps } from './StudyRoundDone'

function props(over: Partial<StudyRoundDoneProps> = {}): StudyRoundDoneProps {
  return {
    counts: { know: 3, fuzzy: 1, forgot: 2 },
    liveSeconds: 65,
    forgotCount: 0,
    mode: 'learn',
    onRetryForgot: vi.fn(),
    onRestart: vi.fn(),
    onExam: vi.fn(),
    onClose: vi.fn(),
    ...over,
  }
}

describe('StudyRoundDone：本轮小结', () => {
  it('显示三项计数与用时；没有忘记词时不显示重练', () => {
    render(<StudyRoundDone {...props()} />)
    expect(screen.getByText(/认识/)).toBeTruthy()
    expect(screen.getByText('3')).toBeTruthy()
    expect(screen.getByText(/用时 1:05/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: /重练忘记的/ })).toBeNull()
  })

  it('有忘记词时可重练；再来一轮/考试/回阅读走回调', () => {
    const onRetryForgot = vi.fn()
    const onRestart = vi.fn()
    const onExam = vi.fn()
    const onClose = vi.fn()
    render(
      <StudyRoundDone
        {...props({ forgotCount: 2, mode: 'review', onRetryForgot, onRestart, onExam, onClose })}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: '重练忘记的 2 个' }))
    fireEvent.click(screen.getByRole('button', { name: /再来一轮（复习）/ }))
    fireEvent.click(screen.getByRole('button', { name: '考试' }))
    fireEvent.click(screen.getByRole('button', { name: '回到阅读' }))
    expect(onRetryForgot).toHaveBeenCalled()
    expect(onRestart).toHaveBeenCalled()
    expect(onExam).toHaveBeenCalled()
    expect(onClose).toHaveBeenCalled()
  })

  it('本轮已经重练过（canRetryForgot=false）就不再给重练按钮，改为一句说明', () => {
    render(<StudyRoundDone {...props({ forgotCount: 2, canRetryForgot: false })} />)
    expect(screen.queryByRole('button', { name: /重练忘记的/ })).toBeNull()
    expect(screen.getByText(/本轮已重练过一次/)).toBeTruthy()
    expect(screen.getByRole('button', { name: /再来一轮/ }).className).toContain('primary')
  })
})
