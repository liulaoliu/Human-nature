// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { render } from '@testing-library/react'
import type { ReactNode } from 'react'
import SessionHost, { type SessionHostProps } from './SessionHost'

vi.mock('./panels/StudyPanel', () => ({ default: () => <div>study-panel</div> }))
vi.mock('./panels/QuizSetupPanel', () => ({ default: () => <div>quiz-setup</div> }))
vi.mock('./panels/QuizPanel', () => ({
  default: ({ sentenceDrill }: { sentenceDrill?: ReactNode }) => (
    <div>quiz-panel{sentenceDrill}</div>
  ),
}))
vi.mock('./panels/DrillSentenceStage', () => ({
  default: ({ results, questions }: { results: unknown[]; questions: unknown[] }) => (
    <div>
      sentence-stage-{results.length}-{questions.length}
    </div>
  ),
}))
vi.mock('./panels/QuickPanel', () => ({ default: () => <div>quick-panel</div> }))
vi.mock('./panels/DictPanel', () => ({ default: () => <div>dict-panel</div> }))
vi.mock('./panels/ListeningPanel', () => ({ default: () => <div>listening-panel</div> }))
vi.mock('./panels/WritingPanel', () => ({ default: () => <div>writing-panel</div> }))
vi.mock('./panels/BackTranslatePanel', () => ({ default: () => <div>back-panel</div> }))

function props(over: Partial<SessionHostProps> = {}): SessionHostProps {
  return {
    items: [],
    speak: vi.fn(),
    resetSpeech: vi.fn(),
    ttsState: 'idle',
    playDictItem: vi.fn(),
    study: {
      api: { queue: null } as never,
      grandSeconds: 0,
      newLimit: 20,
      newToday: 0,
      onNewLimitChange: vi.fn(),
    },
    quiz: { setupOpen: false, queue: null, poolSizes: { unmastered: 0 } } as never,
    quizArticleAvailable: 0,
    quick: { queue: null } as never,
    dict: { queue: null } as never,
    listening: {
      api: { open: false, quiz: null } as never,
      transcript: null,
      readingAll: false,
      readMode: false,
      onToggleRead: vi.fn(),
      onClose: vi.fn(),
    },
    writing: { open: false } as never,
    back: { open: false } as never,
    production: { open: false } as never,
    productionActions: {},
    writingActions: {},
    drillWriting: {
      writingHistory: [],
      setWritingHistory: vi.fn(),
      flash: vi.fn(),
      recordActivity: vi.fn(),
      articleId: 'a1',
      articleTitle: '文章',
    },
    ...over,
  }
}

describe('SessionHost', () => {
  it('没有进行中的会话时什么都不渲染', () => {
    const { container } = render(<SessionHost {...props()} />)
    expect(container.textContent).toBe('')
  })

  it('按各自状态路由到对应面板', () => {
    const { container } = render(
      <SessionHost
        {...props({
          study: { ...props().study, api: { queue: [{ id: 'w1' }] } as never },
          quick: { queue: [{ id: 'w1' }], index: 0 } as never,
          dict: { queue: [{ id: 'd1' }], roundInfo: { grand: 0, offset: 0 } } as never,
          listening: { ...props().listening, api: { open: true, quiz: { questions: [] } } as never },
          writing: { open: true } as never,
        })}
      />,
    )
    const text = container.textContent ?? ''
    expect(text).toContain('study-panel')
    expect(text).toContain('quick-panel')
    expect(text).toContain('dict-panel')
    expect(text).toContain('listening-panel')
    expect(text).toContain('writing-panel')
    expect(text).not.toContain('quiz-')
  })

  it('考试设置与答题互斥：有队列就进答题', () => {
    const { container, rerender } = render(
      <SessionHost {...props({ quiz: { setupOpen: true, queue: null, poolSizes: { unmastered: 0 } } as never })} />,
    )
    expect(container.textContent).toContain('quiz-setup')

    rerender(<SessionHost {...props({ quiz: { setupOpen: true, queue: [{}], index: 0, poolSizes: { unmastered: 0 } } as never })} />)
    expect(container.textContent).toContain('quiz-panel')
    expect(container.textContent).not.toContain('quiz-setup')
  })

  it('拷打挂起去背单词：只画背单词，不把两套面板叠在一起', () => {
    const { container } = render(
      <SessionHost
        {...props({
          study: { ...props().study, api: { queue: [{ id: 'w1' }] } as never },
          quiz: { setupOpen: false, queue: [{}], index: 1, poolSizes: { unmastered: 0 } } as never,
        })}
      />,
    )
    const text = container.textContent ?? ''
    expect(text).toContain('study-panel')
    expect(text).not.toContain('quiz-panel')
  })

  it('拷打结算页的造句用整轮结果，不跟着重练小轮缩水', () => {
    const fiveResults = Array.from({ length: 5 }, (_, i) => ({
      id: `q${i}`,
      itemId: `w${i}`,
      correct: i !== 0,
    }))
    const fiveQuestions = Array.from({ length: 5 }, (_, i) => ({ id: `q${i}`, itemId: `w${i}` }))
    const { container } = render(
      <SessionHost
        {...props({
          quiz: {
            setupOpen: false,
            queue: [fiveQuestions[0]],
            index: 1,
            drill: 'memory',
            results: [fiveResults[0]],
            sentenceResults: fiveResults,
            sentenceQuestions: fiveQuestions,
            poolSizes: { unmastered: 0 },
          } as never,
        })}
      />,
    )
    expect(container.textContent).toContain('sentence-stage-5-5')
  })
})
