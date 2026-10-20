// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import type { QuizQuestion } from '../../core/quiz'
import { vocabItem } from '../../core/testFixtures'
import QuizPanel, { type QuizPanelProps } from './QuizPanel'

function question(over: Partial<QuizQuestion> = {}): QuizQuestion {
  return {
    id: 'v1:spell',
    itemId: 'v1',
    lemma: 'run',
    kind: 'spell',
    word: 'run',
    prompt: '跑',
    meaning: '跑',
    partOfSpeech: null,
    answer: 'run',
    ...over,
  }
}

function props(over: Partial<QuizPanelProps> = {}): QuizPanelProps {
  const noop = vi.fn()
  return {
    question: question(),
    scope: 'article',
    articleRun: false,
    queueLength: 5,
    index: 0,
    seconds: 65,
    results: [],
    checked: false,
    input: '',
    result: null,
    items: [vocabItem({ id: 'v1', word: 'run', lemma: 'run', meaning: '跑' })],
    onClose: noop,
    onSpeak: noop,
    onResetSpeech: noop,
    ttsState: 'idle',
    onSubmit: noop,
    onNext: noop,
    onRetryWrong: noop,
    onRestart: noop,
    onSelectOption: noop,
    onInputChange: noop,
    ...over,
  }
}

describe('QuizPanel：输入题', () => {
  it('显示范围/进度/计时/正确数；输入经 formatAnswerInput 回填', () => {
    const onInputChange = vi.fn()
    render(<QuizPanel {...props({ onInputChange, results: [{ id: 'a', itemId: 'v1', correct: true }] })} />)
    expect(screen.getByText('范围：本篇')).toBeTruthy()
    expect(screen.getByText('1 / 5')).toBeTruthy()
    expect(screen.getByText('⏱ 1:05')).toBeTruthy()
    expect(screen.getByText('正确 1 / 1')).toBeTruthy()

    const input = screen.getByPlaceholderText('输入答案，回车提交 / 下一题')
    expect(document.activeElement).toBe(input)
    fireEvent.change(input, { target: { value: '  rUn ' } })
    expect(onInputChange).toHaveBeenCalledWith('run')
  })

  it('拼写题干带词性释义；提交后显示对错与下一题/看结果', () => {
    const onNext = vi.fn()
    const { rerender } = render(<QuizPanel {...props({ question: question({ partOfSpeech: 'v.' }) })} />)
    expect(screen.getByText('跑')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '提交（回车）' }))
    expect(screen.getByRole('button', { name: '提交（回车）' })).toBeTruthy()

    rerender(
      <QuizPanel
        {...props({
          question: question({ partOfSpeech: 'v.' }),
          checked: true,
          result: false,
          input: 'ran',
          index: 4,
          onNext,
        })}
      />,
    )
    expect(screen.getByText('✘ 正确答案：run')).toBeTruthy()
    expect((screen.getByPlaceholderText('输入答案，回车提交 / 下一题') as HTMLInputElement).disabled).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: '看结果（回车）' }))
    expect(onNext).toHaveBeenCalled()
  })

  it('搭配默写显示专门的提示，而不是字母掩码', () => {
    render(
      <QuizPanel
        {...props({
          question: question({ kind: 'collocation', prompt: '搭配', answer: 'run fast' }),
        })}
      />,
    )
    expect(screen.getByText(/写出一条「run」的搭配/)).toBeTruthy()
  })
})

describe('QuizPanel：选项题', () => {
  it('选项点击回调；checked 后锁定并标出正确/错选', () => {
    const onSelectOption = vi.fn()
    const q = question({ kind: 'choice', options: ['run', 'walk'], answer: 'run' })
    const { rerender } = render(<QuizPanel {...props({ question: q, onSelectOption })} />)
    expect(screen.queryByPlaceholderText('输入答案，回车提交 / 下一题')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /walk/ }))
    expect(onSelectOption).toHaveBeenCalledWith('walk')

    rerender(<QuizPanel {...props({ question: q, checked: true, input: 'walk', result: false })} />)
    expect((screen.getByRole('button', { name: /walk/ }) as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByRole('button', { name: /run/ }) as HTMLButtonElement).className).toContain('primary')
    expect((screen.getByRole('button', { name: /walk/ }) as HTMLButtonElement).className).toContain('danger')
  })

  it('听力题：播放入口随 ttsState 变化；重启语音会尝试重播', () => {
    const onSpeak = vi.fn()
    const onResetSpeech = vi.fn()
    const q = question({ kind: 'listen', audioText: 'Run fast.', answer: 'run' })
    const { rerender } = render(
      <QuizPanel {...props({ question: q, onSpeak, onResetSpeech, ttsState: 'loading' })} />,
    )
    expect(screen.getByRole('button', { name: '🔊 合成中…' })).toBeTruthy()

    rerender(<QuizPanel {...props({ question: q, onSpeak, onResetSpeech })} />)
    fireEvent.click(screen.getByRole('button', { name: '🔊 播放句子' }))
    expect(onSpeak).toHaveBeenCalledWith('Run fast.')

    fireEvent.click(screen.getByRole('button', { name: /重启语音/ }))
    expect(onResetSpeech).toHaveBeenCalled()
    expect(onSpeak).toHaveBeenCalledWith('Run fast.')
  })

  it('看词选义显示单词与朗读；文章测验/鞭打轮次有标签', () => {
    const onSpeak = vi.fn()
    render(
      <QuizPanel
        {...props({
          question: question({ kind: 'meaning', answer: '跑' }),
          articleRun: true,
          drillRound: 2,
          onSpeak,
        })}
      />,
    )
    expect(screen.getByText('文章测验 · 🔁 鞭打第 2 轮')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '朗读' }))
    expect(onSpeak).toHaveBeenCalledWith('run')
  })
})

describe('QuizPanel：结算', () => {
  it('显示正确率、用时与错词（去重、查不到词条则跳过）', () => {
    render(
      <QuizPanel
        {...props({
          question: null,
          seconds: 125,
          results: [
            { id: 'a', itemId: 'v1', correct: false },
            { id: 'b', itemId: 'v1', correct: true },
            { id: 'c', itemId: 'missing', correct: false },
          ],
        })}
      />,
    )
    expect(screen.getByText(/答对/)).toBeTruthy()
    expect(screen.getByText(/正确率 33%/)).toBeTruthy()
    expect(screen.getByText(/用时 2:05/)).toBeTruthy()
    expect(screen.getByText('run')).toBeTruthy()
    expect(screen.getByText('— 跑')).toBeTruthy()
    expect(screen.getByRole('button', { name: '🔁 继续鞭打错题 2' })).toBeTruthy()
  })

  it('没有错题时不显示继续鞭打，再来一轮为主按钮', () => {
    const onRestart = vi.fn()
    const onClose = vi.fn()
    render(
      <QuizPanel
        {...props({
          question: null,
          results: [{ id: 'a', itemId: 'v1', correct: true }],
          onRestart,
          onClose,
        })}
      />,
    )
    expect(screen.queryByRole('button', { name: /继续鞭打/ })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '再来一轮' }))
    fireEvent.click(screen.getByRole('button', { name: '回到阅读' }))
    expect(onRestart).toHaveBeenCalled()
    expect(onClose).toHaveBeenCalled()
  })

  it('没有作答时正确率不显示，直接给 0/0', () => {
    render(<QuizPanel {...props({ question: null, results: [] })} />)
    expect(screen.getByText(/考试结束：答对/)).toBeTruthy()
    expect(screen.queryByText(/正确率/)).toBeNull()
  })
})
