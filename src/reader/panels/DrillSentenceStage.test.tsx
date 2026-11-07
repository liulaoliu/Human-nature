// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { defaultReviewState, type GoldenExamItem, type VocabItem } from '../../types/document'
import type { GoldenImitationApi, UseGoldenImitationParams } from '../hooks/useGoldenImitation'

const useGoldenImitationMock = vi.fn()

vi.mock('../hooks/useGoldenImitation', () => ({
  useGoldenImitation: (params: UseGoldenImitationParams) => useGoldenImitationMock(params),
}))

import DrillSentenceStage from './DrillSentenceStage'

function item(over: Partial<VocabItem> = {}): VocabItem {
  return {
    id: 'v1',
    word: 'run',
    lemma: 'run',
    phonetic: null,
    partOfSpeech: null,
    meaning: '跑',
    usage: [],
    examples: [],
    source: null,
    status: 'queried',
    note: '',
    tags: [],
    reviewState: defaultReviewState(),
    createdAt: '2026-11-07T00:00:00.000Z',
    updatedAt: '2026-11-07T00:00:00.000Z',
    ...over,
  }
}

function fakeApi(current: GoldenExamItem | null): GoldenImitationApi {
  return {
    current,
    answer: '',
    setAnswer: vi.fn(),
    grade: vi.fn().mockResolvedValue('graded'),
    grading: false,
    error: '',
    feedback: null,
    copyGradePrompt: vi.fn().mockResolvedValue(true),
    applyGrade: vi.fn().mockReturnValue(true),
    reset: vi.fn(),
    attempts: [],
    viewing: null,
    earlier: vi.fn(),
    later: vi.fn(),
    backToLive: vi.fn(),
    round: 1,
    canRewrite: false,
    rewrite: vi.fn(),
  } as unknown as GoldenImitationApi
}

function renderStage(over: Partial<Parameters<typeof DrillSentenceStage>[0]> = {}) {
  const setWritingHistory = vi.fn()
  const flash = vi.fn()
  const recordActivity = vi.fn()
  return render(
    <DrillSentenceStage
      kind="memory"
      items={[item()]}
      results={[{ id: 'q1', itemId: 'v1', correct: false }]}
      articleId="A"
      articleTitle="文章"
      writingHistory={[]}
      setWritingHistory={setWritingHistory}
      flash={flash}
      recordActivity={recordActivity}
      {...over}
    />,
  )
}

beforeEach(() => {
  useGoldenImitationMock.mockReset()
  useGoldenImitationMock.mockImplementation((params: UseGoldenImitationParams) => fakeApi(params.current))
})

describe('DrillSentenceStage：拷打结算页的造句', () => {
  it('记忆拷打：每个词独立一题，不再把所有词塞进一句', () => {
    renderStage({
      items: [item(), item({ id: 'v2', word: 'make', lemma: 'make', meaning: '制造' })],
      results: [
        { id: 'q1', itemId: 'v1', correct: true },
        { id: 'q2', itemId: 'v2', correct: false },
      ],
    })

    const calls = useGoldenImitationMock.mock.calls.map(
      ([params]) => params as UseGoldenImitationParams,
    )
    expect(calls).toHaveLength(2)
    expect(calls[0].source).toBe('drillSentence')
    expect(calls[0].articleId).toBe('A')
    expect(calls[0].current?.task).toContain('run（跑）')
    expect(calls[0].current?.task).not.toContain('make')
    expect(calls[0].current?.mustUse).toEqual(['run'])
    expect(calls[0].current?.id).toMatch(/^drill:memory:/)

    expect(calls[1].current?.task).toContain('make（制造）')
    expect(calls[1].current?.task).not.toContain('run')
    expect(calls[1].current?.mustUse).toEqual(['make'])
    expect(calls[1].current?.id).not.toBe(calls[0].current?.id)

    expect(screen.getByText('✍️ 用学过的内容造句')).toBeTruthy()
    expect(screen.getByText(/共 2 题 · 每个词独立一题/)).toBeTruthy()
    const first = screen.getByRole('button', { name: '1. run' })
    const second = screen.getByRole('button', { name: '2. make' })
    expect(first.getAttribute('aria-pressed')).toBe('true')
    expect(second.getAttribute('aria-pressed')).toBe('false')
    fireEvent.click(second)
    expect(second.getAttribute('aria-pressed')).toBe('true')

    expect(screen.getAllByText(/本轮记忆拷打已考完/)).toHaveLength(2)
    expect(screen.getByRole('button', { name: '提交 AI 批改' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '复制批改提示词' })).toBeTruthy()
    // 嵌在结算页里：没有自己的「下一步」按钮
    expect(screen.queryByRole('button', { name: '下一步' })).toBeNull()
  })

  it('词块拷打：每个词条只取一个词块，题面不混别的词块', () => {
    renderStage({
      kind: 'chunk',
      items: [item({ phrases: ['run out of — 用完', 'run into'] })],
    })

    const params = useGoldenImitationMock.mock.calls[0][0] as UseGoldenImitationParams
    expect(params.current?.task).toContain('本轮词块拷打')
    expect(params.current?.task).toContain('run out of（用完）')
    expect(params.current?.task).not.toContain('run into')
    expect(params.current?.mustUse).toEqual(['run out of'])
    expect(screen.getByText(/共 1 题 · 每个词块独立一题/)).toBeTruthy()
    expect(screen.getByText(/本轮词块拷打已考完/)).toBeTruthy()
  })

  it('没有可造句的素材：整块不渲染，也不创建批改 hook', () => {
    const { container } = renderStage({ items: [], results: [] })
    expect(container.innerHTML).toBe('')
    expect(useGoldenImitationMock).not.toHaveBeenCalled()
  })

  it('结算区能直接展开造句历史，默认只列本篇拷打造句', () => {
    const feedback = {
      version: 2 as const,
      scores: [],
      total: 8,
      max: 10,
      issues: [],
    }
    renderStage({
      writingHistory: [
        {
          at: '2026-11-07T00:00:00.000Z',
          articleId: 'A',
          articleTitle: '文章',
          model: '',
          text: 'A drill',
          feedback,
          source: 'drillSentence',
          sentenceId: 'drill:A',
        },
        {
          at: '2026-11-08T00:00:00.000Z',
          articleId: 'B',
          articleTitle: '别的文章',
          model: '',
          text: 'B drill',
          feedback,
          source: 'drillSentence',
          sentenceId: 'drill:B',
        },
      ],
    })

    fireEvent.click(screen.getByRole('button', { name: '查看造句历史' }))
    expect(screen.getByText('造句历史（1）')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /拷打造句/ }))
    expect(screen.getByText('A drill')).toBeTruthy()
    expect(screen.queryByText('B drill')).toBeNull()
  })
})
