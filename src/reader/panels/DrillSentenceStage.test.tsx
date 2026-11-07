// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
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
  it('记忆拷打：用本轮词 + 词义拼题，批改走 drillSentence 来源', () => {
    renderStage({
      items: [item(), item({ id: 'v2', word: 'make', lemma: 'make', meaning: '制造' })],
      results: [
        { id: 'q1', itemId: 'v1', correct: true },
        { id: 'q2', itemId: 'v2', correct: false },
      ],
    })

    const params = useGoldenImitationMock.mock.calls[0][0] as UseGoldenImitationParams
    expect(params.source).toBe('drillSentence')
    expect(params.articleId).toBe('A')
    expect(params.current?.task).toContain('本轮记忆拷打')
    expect(params.current?.task).toContain('run（跑）')
    expect(params.current?.task).toContain('make（制造）')
    expect(params.current?.mustUse).toEqual(['run', 'make'])
    expect(params.current?.id).toMatch(/^drill:memory:/)

    expect(screen.getByText('✍️ 用学过的内容造句')).toBeTruthy()
    expect(screen.getByText(/本轮记忆拷打已考完/)).toBeTruthy()
    expect(screen.getByRole('button', { name: '提交 AI 批改' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '复制批改提示词' })).toBeTruthy()
    // 嵌在结算页里：没有自己的「下一步」按钮
    expect(screen.queryByRole('button', { name: '下一步' })).toBeNull()
  })

  it('词块拷打：题面取词块和中文释义', () => {
    renderStage({
      kind: 'chunk',
      items: [item({ phrases: ['run out of — 用完'] })],
    })

    const params = useGoldenImitationMock.mock.calls[0][0] as UseGoldenImitationParams
    expect(params.current?.task).toContain('本轮词块拷打')
    expect(params.current?.task).toContain('run out of（用完）')
    expect(params.current?.mustUse).toEqual(['run out of'])
    expect(screen.getByText(/本轮词块拷打已考完/)).toBeTruthy()
  })

  it('没有可造句的素材：整块不渲染', () => {
    const { container } = renderStage({ items: [], results: [] })
    expect(container.innerHTML).toBe('')
    const params = useGoldenImitationMock.mock.calls[0][0] as UseGoldenImitationParams
    expect(params.current).toBeNull()
  })
})
