// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import type { ListeningQuestion } from '../../core/listening'
import ListeningPanel, { type ListeningPanelProps } from './ListeningPanel'

const questions: ListeningQuestion[] = [
  { id: 'q1', type: 'mcq', stem: 'What did he do?', options: ['run', 'walk'], answer: 'run' },
  { id: 'q2', type: 'gap', stem: 'He ___ fast.', answer: 'runs' },
]

function props(over: Partial<ListeningPanelProps> = {}): ListeningPanelProps {
  const noop = vi.fn()
  return {
    questions,
    answers: {},
    submitted: false,
    result: null,
    onlyWrong: false,
    readingAll: false,
    transcript: 'He runs fast.',
    ttsState: 'idle',
    onClose: noop,
    onToggleRead: noop,
    onResetSpeech: noop,
    onAnswer: noop,
    onSubmit: noop,
    onRetryWrong: noop,
    onShowAll: noop,
    onRegenerate: noop,
    ...over,
  }
}

describe('ListeningPanel：作答', () => {
  it('选择题点选项回填；填空题输入回填', () => {
    const onAnswer = vi.fn()
    render(<ListeningPanel {...props({ onAnswer })} />)
    fireEvent.click(screen.getByRole('button', { name: 'run' }))
    expect(onAnswer).toHaveBeenCalledWith('q1', 'run')
    fireEvent.change(screen.getByPlaceholderText('填空'), { target: { value: 'runs' } })
    expect(onAnswer).toHaveBeenCalledWith('q2', 'runs')
  })

  it('未提交不显示对错；提交后锁住输入并显示判分与解析', () => {
    const { rerender } = render(<ListeningPanel {...props({ answers: { q1: 'run', q2: 'run' } })} />)
    expect(screen.queryByText('✔ 正确')).toBeNull()

    rerender(
      <ListeningPanel
        {...props({
          answers: { q1: 'run', q2: 'run' },
          submitted: true,
          result: { total: 2, correct: 1, score: 0.5 },
        })}
      />,
    )
    expect(screen.getByText('✔ 正确')).toBeTruthy()
    expect(screen.getByText('✘ 正确答案：runs')).toBeTruthy()
    expect(screen.getByText('得分 1/2（50%）')).toBeTruthy()
    expect((screen.getByRole('button', { name: 'run' }) as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByPlaceholderText('填空') as HTMLInputElement).disabled).toBe(true)
  })

  it('提交后：有错题才显示「重做错题」，重做全部始终可用', () => {
    const onRetryWrong = vi.fn()
    const onShowAll = vi.fn()
    const { rerender } = render(
      <ListeningPanel
        {...props({
          submitted: true,
          result: { total: 2, correct: 1, score: 0.5 },
          onRetryWrong,
          onShowAll,
        })}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: '重做错题 1' }))
    expect(onRetryWrong).toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: '重做全部' }))
    expect(onShowAll).toHaveBeenCalled()

    rerender(
      <ListeningPanel {...props({ submitted: true, result: { total: 2, correct: 2, score: 1 } })} />,
    )
    expect(screen.queryByRole('button', { name: /重做错题/ })).toBeNull()
  })

  it('只做错题有标签；重新出题回调', () => {
    const onRegenerate = vi.fn()
    render(<ListeningPanel {...props({ onlyWrong: true, onRegenerate })} />)
    expect(screen.getByText(/只做错题/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '重新出题' }))
    expect(onRegenerate).toHaveBeenCalled()
  })
})

describe('ListeningPanel：朗读与原文', () => {
  it('朗读状态映射到按钮文案', () => {
    const { rerender } = render(<ListeningPanel {...props()} />)
    expect(screen.getByRole('button', { name: '🔊 播放全文' })).toBeTruthy()

    rerender(<ListeningPanel {...props({ ttsState: 'loading' })} />)
    expect(screen.getByRole('button', { name: '🔊 合成中…' })).toBeTruthy()

    rerender(<ListeningPanel {...props({ readingAll: true })} />)
    expect(screen.getByRole('button', { name: '⏹ 停止' })).toBeTruthy()
  })

  it('阅读理解模式先展开原文；提交后可再展开原文', () => {
    const { rerender } = render(<ListeningPanel {...props({ readMode: true })} />)
    expect(screen.getByText('原文（阅读理解：先读原文再答题）')).toBeTruthy()
    expect(screen.getByText('He runs fast.')).toBeTruthy()

    rerender(<ListeningPanel {...props({ submitted: true, result: { total: 2, correct: 2, score: 1 } })} />)
    expect(screen.getByText('显示原文')).toBeTruthy()
  })

  it('没原文时不渲染原文区块；结束/重启语音回调', () => {
    const onClose = vi.fn()
    const onResetSpeech = vi.fn()
    render(<ListeningPanel {...props({ transcript: null, onClose, onResetSpeech })} />)
    expect(screen.queryByText('显示原文')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '结束（Esc）' }))
    fireEvent.click(screen.getByRole('button', { name: /重启语音/ }))
    expect(onClose).toHaveBeenCalled()
    expect(onResetSpeech).toHaveBeenCalled()
  })
})
