// @vitest-environment jsdom
import { renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { useQueueAutoSpeak } from './useQueueAutoSpeak'
import type { QuizQuestion } from '../../core/quiz'

const q = (over: Partial<QuizQuestion>) => ({ id: 'q1', kind: 'spell', audioText: 'hello', ...over }) as QuizQuestion

const base = {
  quizQueue: null,
  quizIndex: 0,
  dictQueue: null,
  dictIndex: 0,
  speak: () => {},
}

describe('useQueueAutoSpeak（题目一换就出声）', () => {
  it('听力题 / 听音辨词自动朗读', () => {
    for (const kind of ['listen', 'ear'] as const) {
      const speak = vi.fn()
      renderHook(() => useQueueAutoSpeak({ ...base, quizQueue: [q({ kind })], speak }))
      expect(speak).toHaveBeenCalledWith('hello')
    }
  })

  it('非听力题不朗读', () => {
    const speak = vi.fn()
    renderHook(() => useQueueAutoSpeak({ ...base, quizQueue: [q({ kind: 'spell' })], speak }))
    expect(speak).not.toHaveBeenCalled()
  })

  it('听力题但没有可念文本时不调（避免空字符串把上一条停掉）', () => {
    const speak = vi.fn()
    renderHook(() => useQueueAutoSpeak({ ...base, quizQueue: [q({ kind: 'listen', audioText: '' })], speak }))
    expect(speak).not.toHaveBeenCalled()
  })

  it('切到下一题会念下一题的文本', () => {
    const speak = vi.fn()
    const quizQueue = [q({ id: 'q1', kind: 'listen', audioText: 'one' }), q({ id: 'q2', kind: 'listen', audioText: 'two' })]
    const view = renderHook((p: { quizIndex: number }) => useQueueAutoSpeak({ ...base, quizQueue, speak, ...p }), {
      initialProps: { quizIndex: 0 },
    })
    expect(speak).toHaveBeenLastCalledWith('one')
    view.rerender({ quizIndex: 1 })
    expect(speak).toHaveBeenLastCalledWith('two')
  })

  it('听写逐句播放', () => {
    const speak = vi.fn()
    renderHook(() => useQueueAutoSpeak({ ...base, dictQueue: [{ text: 'the first line' }], dictIndex: 0, speak }))
    expect(speak).toHaveBeenCalledWith('the first line')
  })

  it('听写索引越界时不念（做完最后一题不会空转）', () => {
    const speak = vi.fn()
    renderHook(() => useQueueAutoSpeak({ ...base, dictQueue: [{ text: 'only' }], dictIndex: 3, speak }))
    expect(speak).not.toHaveBeenCalled()
  })

  it('两个队列都没开时不念', () => {
    const speak = vi.fn()
    renderHook(() => useQueueAutoSpeak({ ...base, speak }))
    expect(speak).not.toHaveBeenCalled()
  })
})
