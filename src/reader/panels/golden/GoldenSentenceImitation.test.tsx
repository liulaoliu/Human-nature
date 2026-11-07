// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import GoldenSentenceImitation from './GoldenSentenceImitation'
import type { GoldenImitationApi } from '../../hooks/useGoldenImitation'

const current = {
  id: 'exam:s1',
  sentenceId: 's1',
  task: '用 in response to 写一句关于环保的新句子。',
  model: 'In response to the pandemic, remote collaboration has become the new norm.',
  structure: 'In response to + n., … has become …',
  mustUse: ['in response to'],
  rubric: [{ dimension: '结构运用', weight: 100 }],
  source: 'local' as const,
}

function fakeImitation(over: Record<string, unknown> = {}) {
  return {
    current,
    answer: 'In response to the flood, remote work has become the new norm.',
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
    ...over,
  } as unknown as GoldenImitationApi
}

function box(): HTMLDetailsElement {
  return document.querySelector('details.golden-exam-paste') as HTMLDetailsElement
}

function paste(value: string) {
  fireEvent.change(screen.getByPlaceholderText(/scores/), { target: { value } })
}

describe('本句仿写：手动复制提示词 → 展开粘贴框 → 应用成功收起', () => {
  it('默认收起；复制成功后展开；应用成功后收起', async () => {
    const imitation = fakeImitation()
    render(<GoldenSentenceImitation imitation={imitation} nextLabel="下一句" onNext={vi.fn()} />)
    expect(box().open).toBe(false)

    fireEvent.click(screen.getByRole('button', { name: '复制批改提示词' }))
    await waitFor(() => expect(box().open).toBe(true))
    expect(imitation.copyGradePrompt).toHaveBeenCalled()

    paste('{"scores":[],"issues":[],"summary":"OK"}')
    fireEvent.click(screen.getByRole('button', { name: '应用' }))
    await waitFor(() => expect(box().open).toBe(false))
    expect(imitation.applyGrade).toHaveBeenCalledWith('{"scores":[],"issues":[],"summary":"OK"}')
  })

  it('应用失败时保持展开，输入不丢', async () => {
    const imitation = fakeImitation({ applyGrade: vi.fn().mockReturnValue(false) })
    render(<GoldenSentenceImitation imitation={imitation} nextLabel="下一句" onNext={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: '复制批改提示词' }))
    await waitFor(() => expect(box().open).toBe(true))

    paste('not json')
    fireEvent.click(screen.getByRole('button', { name: '应用' }))
    expect(box().open).toBe(true)
    expect((screen.getByPlaceholderText(/scores/) as HTMLTextAreaElement).value).toBe('not json')
  })

  it('按批改意见再写一稿后，复制展开 / 应用收起照旧', async () => {
    const imitation = fakeImitation({ canRewrite: true })
    render(<GoldenSentenceImitation imitation={imitation} nextLabel="下一句" onNext={vi.fn()} />)

    fireEvent.click(screen.getByRole('button', { name: '复制批改提示词' }))
    await waitFor(() => expect(box().open).toBe(true))
    paste('{"scores":[],"issues":[],"summary":"OK"}')
    fireEvent.click(screen.getByRole('button', { name: '应用' }))
    await waitFor(() => expect(box().open).toBe(false))

    fireEvent.click(screen.getByRole('button', { name: '按批改意见再写一稿' }))
    expect(imitation.rewrite).toHaveBeenCalled()
    expect(box().open).toBe(false)

    fireEvent.click(screen.getByRole('button', { name: '复制批改提示词' }))
    await waitFor(() => expect(box().open).toBe(true))
    paste('{"scores":[],"issues":[],"summary":"OK 2"}')
    fireEvent.click(screen.getByRole('button', { name: '应用' }))
    await waitFor(() => expect(box().open).toBe(false))
  })

  it('不给下一步时不画「下一步」按钮；提示语可替换（拷打造句复用）', () => {
    const imitation = fakeImitation()
    render(<GoldenSentenceImitation imitation={imitation} hint="用本轮学过的词造句。" />)
    expect(screen.getByText('用本轮学过的词造句。')).toBeTruthy()
    expect(screen.queryByRole('button', { name: '下一步' })).toBeNull()
    expect(screen.getByRole('button', { name: '提交 AI 批改' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '复制批改提示词' })).toBeTruthy()
  })

  it('AI 直连批改不展开；没配 AI 改成复制提示词时才展开', async () => {
    const graded = fakeImitation({ grade: vi.fn().mockResolvedValue('graded') })
    const { unmount } = render(
      <GoldenSentenceImitation imitation={graded} nextLabel="下一句" onNext={vi.fn()} />,
    )
    fireEvent.click(screen.getByRole('button', { name: '提交 AI 批改' }))
    await waitFor(() => expect(graded.grade).toHaveBeenCalled())
    expect(box().open).toBe(false)
    unmount()

    const copied = fakeImitation({ grade: vi.fn().mockResolvedValue('copied') })
    render(<GoldenSentenceImitation imitation={copied} nextLabel="下一句" onNext={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: '提交 AI 批改' }))
    await waitFor(() => expect(box().open).toBe(true))
  })
})
