// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import type { ClozeQuestion, DiffToken } from '../../core/dictation'
import DictPanel, { type DictItem, type DictPanelProps } from './DictPanel'

const queue: DictItem[] = [
  { id: 's1', text: 'Run fast now.' },
  { id: 's2', text: 'Walk slow.' },
]

const diff: DiffToken[] = [
  { type: 'same', text: 'Run' },
  { type: 'del', text: 'fast' },
  { type: 'same', text: 'now.' },
]

const cloze: ClozeQuestion = {
  sentence: 'Run fast now.',
  display: 'Run [1] now.',
  parts: [
    { text: 'Run ', blank: false, start: 0 },
    { text: 'fast', blank: true, start: 4, index: 1 },
    { text: ' now.', blank: false, start: 8 },
  ],
  blanks: [{ answer: 'fast', accept: ['fast'] }],
}

function props(over: Partial<DictPanelProps> = {}): DictPanelProps {
  const noop = vi.fn()
  return {
    queue,
    index: 0,
    mode: 'full',
    words: 20,
    blankCount: 1,
    clozeWords: 40,
    maxQuestions: 10,
    grandTotal: 2,
    roundOffset: 0,
    checked: false,
    diff: null,
    cloze: null,
    blanks: [],
    input: '',
    results: [],
    wrongItems: [],
    onStart: noop,
    onCheck: noop,
    onNext: noop,
    onWrongNow: noop,
    onRetryWrong: noop,
    onClose: noop,
    onSpeak: noop,
    onPlayItem: noop,
    onResetSpeech: noop,
    ttsState: 'idle',
    onInputChange: noop,
    onBlankChange: noop,
    ...over,
  }
}

describe('DictPanel：整句模式', () => {
  it('进度/轮次范围/输入焦点的接线', () => {
    render(<DictPanel {...props({ grandTotal: 10, queue: queue.slice(0, 1), roundOffset: 0 })} />)
    expect(screen.getByText('1 / 1（第 1–1 / 全篇 10）')).toBeTruthy()
    expect(document.activeElement).toBe(screen.getByPlaceholderText('听写这一句，回车检查 / 下一句'))
  })

  it('输入受控；检查后显示 diff 与原文，错词可点听', () => {
    const onInputChange = vi.fn()
    const onSpeak = vi.fn()
    const { container, rerender } = render(<DictPanel {...props({ onInputChange, onSpeak })} />)
    fireEvent.change(screen.getByPlaceholderText('听写这一句，回车检查 / 下一句'), {
      target: { value: 'Run fast now.' },
    })
    expect(onInputChange).toHaveBeenCalledWith('Run fast now.')

    rerender(<DictPanel {...props({ checked: true, diff, onSpeak })} />)
    const words = [...container.querySelectorAll('.dict-word')]
    expect(words.map((w) => w.textContent)).toEqual(['Run', 'fast', 'now'])
    fireEvent.click(words[0])
    expect(onSpeak).toHaveBeenCalledWith('Run fast now.')
    fireEvent.click(words[2])
    expect(onSpeak).toHaveBeenLastCalledWith('now.')
  })

  it('模式/难度/题量改动都重开一轮', () => {
    const onStart = vi.fn()
    const { rerender } = render(<DictPanel {...props({ onStart })} />)
    fireEvent.click(screen.getByRole('button', { name: '填空' }))
    expect(onStart).toHaveBeenCalledWith({ mode: 'cloze' })
    fireEvent.change(screen.getByDisplayValue('每句 20 词'), { target: { value: '5' } })
    expect(onStart).toHaveBeenCalledWith({ words: 5 })
    fireEvent.change(screen.getByDisplayValue('每轮 10 题'), { target: { value: '0' } })
    expect(onStart).toHaveBeenCalledWith({ max: 0 })

    rerender(<DictPanel {...props({ mode: 'cloze', onStart })} />)
    fireEvent.change(screen.getByDisplayValue('每段 40 词'), { target: { value: '10' } })
    expect(onStart).toHaveBeenCalledWith({ clozeWords: 10 })
    fireEvent.change(screen.getByDisplayValue('填空 1 个/题'), { target: { value: '3' } })
    expect(onStart).toHaveBeenCalledWith({ blanks: 3 })
  })

  it('再听一遍/重启语音/结束都走回调', () => {
    const onPlayItem = vi.fn()
    const onResetSpeech = vi.fn()
    const onClose = vi.fn()
    render(<DictPanel {...props({ onPlayItem, onResetSpeech, onClose })} />)
    fireEvent.click(screen.getByRole('button', { name: '🔊 再听一遍' }))
    expect(onPlayItem).toHaveBeenCalledWith(queue[0])

    fireEvent.click(screen.getByRole('button', { name: /重启语音/ }))
    expect(onResetSpeech).toHaveBeenCalled()
    expect(onPlayItem).toHaveBeenCalledTimes(2)

    fireEvent.click(screen.getByRole('button', { name: '结束（Esc）' }))
    expect(onClose).toHaveBeenCalled()
  })

  it('合成中显示进度文案', () => {
    render(<DictPanel {...props({ ttsState: 'loading' })} />)
    expect(screen.getByRole('button', { name: '🔊 合成中…' })).toBeTruthy()
  })
})

describe('DictPanel：填空模式', () => {
  it('挖空句显示编号，非空段可点听', () => {
    const onSpeak = vi.fn()
    render(<DictPanel {...props({ mode: 'cloze', cloze, onSpeak })} />)
    expect(screen.getByText('[1]')).toBeTruthy()
    expect(screen.getByPlaceholderText('听写第 1 个空')).toBeTruthy()
    expect(document.activeElement).toBe(screen.getByPlaceholderText('听写第 1 个空'))
    fireEvent.click(screen.getByText('Run'))
    expect(onSpeak).toHaveBeenCalledWith('Run fast now.')
  })

  it('空值受控；方向键在多个空之间移动焦点', () => {
    const onBlankChange = vi.fn()
    const q: ClozeQuestion = {
      ...cloze,
      parts: [
        { text: 'Run ', blank: false, start: 0 },
        { text: 'fast', blank: true, start: 4, index: 1 },
        { text: ' ', blank: false, start: 8 },
        { text: 'now', blank: true, start: 9, index: 2 },
      ],
      blanks: [
        { answer: 'fast', accept: ['fast'] },
        { answer: 'now', accept: ['now'] },
      ],
    }
    render(<DictPanel {...props({ mode: 'cloze', cloze: q, onBlankChange })} />)
    const first = screen.getByPlaceholderText('听写第 1 个空')
    const second = screen.getByPlaceholderText('听写第 2 个空')

    fireEvent.change(first, { target: { value: 'fast' } })
    expect(onBlankChange).toHaveBeenCalledWith(0, 'fast')
    fireEvent.keyDown(first, { key: 'ArrowDown' })
    expect(document.activeElement).toBe(second)
    fireEvent.keyDown(second, { key: 'ArrowUp' })
    expect(document.activeElement).toBe(first)
  })

  it('检查后：填对/填错给不同样式，原文高亮错词', () => {
    const { rerender, container } = render(
      <DictPanel {...props({ mode: 'cloze', cloze, checked: true, blanks: ['fast'] })} />,
    )
    expect((screen.getByPlaceholderText('听写第 1 个空') as HTMLInputElement).className).toContain('ok')
    expect(container.querySelector('.dict-word.wrong')).toBeNull()

    rerender(<DictPanel {...props({ mode: 'cloze', cloze, checked: true, blanks: ['wrong'] })} />)
    expect((screen.getByPlaceholderText('听写第 1 个空') as HTMLInputElement).className).toContain('bad')
    expect(container.querySelector('.dict-word.wrong')?.textContent).toBe('fast')
  })
})

describe('DictPanel：判分与结算', () => {
  it('检查后出现「漏词加入待选」；最后一题显示完成', () => {
    const onWrongNow = vi.fn()
    const { rerender } = render(<DictPanel {...props({ checked: true, onWrongNow })} />)
    fireEvent.click(screen.getByRole('button', { name: '漏词加入待选' }))
    expect(onWrongNow).toHaveBeenCalled()

    rerender(<DictPanel {...props({ checked: true, index: 1 })} />)
    expect(screen.getByRole('button', { name: '完成（回车）' })).toBeTruthy()
  })

  it('结算：正确率、错题、重练/下一批/回到阅读', () => {
    const onRetryWrong = vi.fn()
    const onStart = vi.fn()
    const onClose = vi.fn()
    const { rerender } = render(
      <DictPanel
        {...props({
          index: 2,
          results: [true, false],
          wrongItems: [queue[1]],
          onRetryWrong,
          onStart,
          onClose,
        })}
      />,
    )
    expect(screen.getByText(/听写完成：答对/)).toBeTruthy()
    expect(screen.getByText(/50%/)).toBeTruthy()
    expect(screen.getByText('错题（1）：')).toBeTruthy()
    expect(screen.getByText('Walk slow.')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '重练错题 1' }))
    expect(onRetryWrong).toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: '再来一遍' }))
    expect(onStart).toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: '回到阅读' }))
    expect(onClose).toHaveBeenCalled()

    rerender(
      <DictPanel
        {...props({
          index: 0,
          queue: queue.slice(0, 1),
          grandTotal: 5,
          results: [true],
          wrongItems: [],
        })}
      />,
    )
    expect(screen.queryByText(/错题/)).toBeNull()
  })

  it('还有下一批时按钮文案是「继续下一批」', () => {
    const onStart = vi.fn()
    render(
      <DictPanel
        {...props({ index: 1, queue: queue.slice(0, 1), grandTotal: 5, results: [true], onStart })}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: '继续下一批' }))
    expect(onStart).toHaveBeenCalled()
  })
})
