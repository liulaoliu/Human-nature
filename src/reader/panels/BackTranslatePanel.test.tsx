// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import BackTranslatePanel from './BackTranslatePanel'
import type { useBackTranslate } from '../hooks/useBackTranslate'
import type { BackTranslationFeedback, BackTranslationRecord } from '../../core/backTranslate'

type Api = ReturnType<typeof useBackTranslate>

const feedback: BackTranslationFeedback = {
  scores: [{ dimension: '意思还原', score: 36, max: 40, comment: '信息完整' }],
  total: 86,
  max: 100,
  issues: [
    { original: 'Rachman', suggestion: 'Rahman', reason: '音译差异', type: 'properNoun', deduct: false },
    { original: 'go school', suggestion: 'went to school', reason: '时态/漏词', type: 'grammar', deduct: true },
  ],
  polished: 'He went to school.',
  alternatives: ['He attended school.'],
  summary: '注意时态。',
}

const record: BackTranslationRecord = {
  id: 'r1',
  at: '2026-10-20T00:00:00.000Z',
  articleId: 'a1',
  articleTitle: 'A Day',
  sentenceId: 's1',
  sourceZh: '他去了学校。',
  answer: 'He went to school.',
  reference: 'He went to school.',
  feedback,
  closeness: { exact: true, ratio: 1 },
}

function makeApi(over: Partial<Api> = {}): Api {
  const api = {
    open: true,
    close: vi.fn(),
    start: vi.fn(),
    queueLength: 2,
    position: 1,
    canPrev: false,
    canNext: true,
    prev: vi.fn(),
    next: vi.fn(),
    retry: vi.fn(),
    loadHistory: vi.fn(() => true),
    current: { id: 's1', paraId: 'p1', text: 'He went to school.', translation: '他去了学校。' },
    sourceZh: '他去了学校。',
    reference: 'He went to school.',
    contextZh: undefined,
    articleTitle: 'A Day',
    answer: 'He went to school.',
    setAnswer: vi.fn(),
    gradedAnswer: '',
    feedback: null,
    error: '',
    grading: false,
    configured: true,
    grade: vi.fn(async () => undefined),
    cancelGrade: vi.fn(),
    manualOpen: false,
    setManualOpen: vi.fn(),
    manualText: '',
    setManualText: vi.fn(),
    applyManual: vi.fn(),
    copyPrompt: vi.fn(async () => undefined),
    articleHistory: [] as BackTranslationRecord[],
    history: [] as BackTranslationRecord[],
    ...over,
  }
  return api as unknown as Api
}

describe('BackTranslatePanel', () => {
  it('提交前只给中文；点 AI 批改走回调', () => {
    const grade = vi.fn(async () => undefined)
    const { container } = render(
      <BackTranslatePanel api={makeApi({ grade, answer: 'He attended school.' })} />,
    )
    expect(container.textContent).toContain('他去了学校。')
    expect(container.textContent).not.toContain('He went to school.')
    fireEvent.click(screen.getByRole('button', { name: 'AI 批改' }))
    expect(grade).toHaveBeenCalled()
  })

  it('批改后显示分数、原文对照、扣分问题与专名不计分提示', () => {
    render(<BackTranslatePanel api={makeApi({ feedback, gradedAnswer: 'He went to school.' })} />)
    expect(screen.getByText('86/100')).toBeTruthy()
    expect(screen.getByText('✅ 和原文一字不差')).toBeTruthy()
    expect(screen.getByText('扣分问题')).toBeTruthy()
    expect(screen.getByText('专名提示（不计分）')).toBeTruthy()
    expect(screen.getByText(/音译差异/)).toBeTruthy()
    expect(screen.getByText(/改写示范/)).toBeTruthy()
  })

  it('没配 key 时提示复制粘贴，并显示粘贴框', () => {
    render(<BackTranslatePanel api={makeApi({ configured: false, manualOpen: true })} />)
    expect(screen.getByText(/本机没配 AI key/)).toBeTruthy()
    expect(screen.getByRole('button', { name: '应用批改' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '复制批改提示词' })).toBeTruthy()
  })

  it('没有当前句但有存档时，默认展开历史存档', () => {
    render(
      <BackTranslatePanel
        api={makeApi({
          current: null,
          sourceZh: '',
          reference: '',
          articleHistory: [],
          history: [record],
        })}
      />,
    )
    expect(screen.getByText('回译存档')).toBeTruthy()
    expect(screen.getByText('全部（1）')).toBeTruthy()
    expect(screen.getByText(/当前没有可回译的句子/)).toBeTruthy()
  })

  it('历史可切换本篇/全部，点开看完整存档', () => {
    const loadHistory = vi.fn(() => true)
    render(
      <BackTranslatePanel
        api={makeApi({ articleHistory: [record], history: [record], loadHistory })}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: '历史（1）' }))
    expect(screen.getByText('回译存档')).toBeTruthy()
    expect(screen.getByText('全部（1）')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /他去了学校/ }))
    expect(loadHistory).toHaveBeenCalledWith(record)
    expect(screen.getByText('存档详情')).toBeTruthy()
  })
})
