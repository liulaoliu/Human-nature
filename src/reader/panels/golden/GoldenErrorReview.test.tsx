// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import GoldenErrorReview from './GoldenErrorReview'
import type { WritingErrorCard } from '../../../core/writingErrorReview'

const card: WritingErrorCard = {
  id: 'errfix:word-spelling|spelling-bureaucracy',
  rule: 'word-spelling',
  type: 'spelling',
  key: 'spelling-bureaucracy',
  original: 'bureacracy',
  suggestion: 'bureaucracy',
  reason: '拼写错误',
  text: 'I learn bureacracy.',
  recordKey: 'r1',
  at: '2026-10-30T00:00:00.000Z',
  articleId: 'a1',
  sentenceId: 's1',
}

describe('GoldenErrorReview', () => {
  it('答对显示答案并记录 correct=true', () => {
    const onAnswer = vi.fn()
    const onBack = vi.fn()
    render(<GoldenErrorReview cards={[card]} onAnswer={onAnswer} onBack={onBack} />)
    expect(screen.getByText('bureacracy')).toBeTruthy()
    fireEvent.change(screen.getByLabelText('错因答案'), { target: { value: 'bureaucracy' } })
    fireEvent.click(screen.getByRole('button', { name: '检查' }))
    expect(onAnswer).toHaveBeenCalledWith(card, true)
    expect(screen.getByText(/对了/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '看本轮结果' }))
    expect(screen.getByText(/本轮完成：答对 1 \/ 1/)).toBeTruthy()
  })

  it('答错 / 看答案都记录 false，并显示正确写法', () => {
    const onAnswer = vi.fn()
    render(<GoldenErrorReview cards={[card]} onAnswer={onAnswer} onBack={vi.fn()} />)
    fireEvent.change(screen.getByLabelText('错因答案'), { target: { value: 'bur' } })
    fireEvent.click(screen.getByRole('button', { name: '检查' }))
    expect(onAnswer).toHaveBeenCalledWith(card, false)
    expect(screen.getByText('bureaucracy')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '看本轮结果' }))
    expect(screen.getByText(/本轮完成：答对 0 \/ 1/)).toBeTruthy()
  })

  it('空队列给出提示', () => {
    render(<GoldenErrorReview cards={[]} onAnswer={vi.fn()} onBack={vi.fn()} />)
    expect(screen.getByText(/今天没有到期的错因卡/)).toBeTruthy()
  })
})
