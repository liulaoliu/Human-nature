// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import GoldenExamView from './GoldenExamView'
import type { GoldenExamApi } from './types'

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

function fakeExam(over: Record<string, unknown> = {}) {
  return {
    unlocked: true,
    after: 5,
    completedCount: 5,
    completedIds: ['s1'],
    items: [current],
    current,
    task: { task: current.task, model: current.model, mustUse: current.mustUse, rubric: current.rubric },
    index: 0,
    answer: 'In response to the flood, remote work has become the new norm.',
    setAnswer: vi.fn(),
    feedback: null,
    grading: false,
    generating: false,
    error: '',
    history: [],
    start: vi.fn(),
    next: vi.fn(),
    prev: vi.fn(),
    generateTasks: vi.fn().mockResolvedValue('generated'),
    copyTaskPrompt: vi.fn().mockResolvedValue(true),
    applyTasks: vi.fn().mockReturnValue(true),
    grade: vi.fn().mockResolvedValue('graded'),
    copyGradePrompt: vi.fn().mockResolvedValue(true),
    applyGrade: vi.fn().mockReturnValue(true),
    ...over,
  } as unknown as GoldenExamApi
}

function gradeBox(): HTMLDetailsElement {
  return document.querySelector('details.golden-exam-paste') as HTMLDetailsElement
}

function taskBox(): HTMLDetailsElement {
  return document.querySelectorAll('details.golden-exam-paste')[1] as HTMLDetailsElement
}

describe('仿写考试：批改结果粘贴框', () => {
  it('默认收起；复制提示词展开；应用成功后收起', async () => {
    const exam = fakeExam()
    render(<GoldenExamView exam={exam} onBack={vi.fn()} />)
    expect(gradeBox().open).toBe(false)

    fireEvent.click(screen.getByRole('button', { name: '复制批改提示词' }))
    await waitFor(() => expect(gradeBox().open).toBe(true))

    fireEvent.change(within(gradeBox()).getByPlaceholderText(/scores/), {
      target: { value: '{"scores":[],"issues":[],"summary":"OK"}' },
    })
    fireEvent.click(within(gradeBox()).getByRole('button', { name: '应用' }))
    await waitFor(() => expect(gradeBox().open).toBe(false))
    expect(exam.applyGrade).toHaveBeenCalledWith('{"scores":[],"issues":[],"summary":"OK"}')
  })

  it('AI 直连批改不展开；没配 AI 改成复制提示词时才展开', async () => {
    const graded = fakeExam({ grade: vi.fn().mockResolvedValue('graded') })
    const { unmount } = render(<GoldenExamView exam={graded} onBack={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: '提交 AI 批改' }))
    await waitFor(() => expect(graded.grade).toHaveBeenCalled())
    expect(gradeBox().open).toBe(false)
    unmount()

    const copied = fakeExam({ grade: vi.fn().mockResolvedValue('copied') })
    render(<GoldenExamView exam={copied} onBack={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: '提交 AI 批改' }))
    await waitFor(() => expect(gradeBox().open).toBe(true))
  })

  it('出题结果框同样默认收起；复制出题提示词展开；应用成功收起', async () => {
    const exam = fakeExam()
    render(<GoldenExamView exam={exam} onBack={vi.fn()} />)
    expect(taskBox().open).toBe(false)

    fireEvent.click(screen.getByRole('button', { name: '复制出题提示词' }))
    await waitFor(() => expect(taskBox().open).toBe(true))

    fireEvent.change(within(taskBox()).getByPlaceholderText(/items/), {
      target: { value: '{"items":[]}' },
    })
    fireEvent.click(within(taskBox()).getByRole('button', { name: '应用' }))
    await waitFor(() => expect(taskBox().open).toBe(false))
    expect(exam.applyTasks).toHaveBeenCalledWith('{"items":[]}')
  })

  it('AI 直连出题不展开；没配 AI 改成复制提示词时才展开', async () => {
    const generated = fakeExam({ generateTasks: vi.fn().mockResolvedValue('generated') })
    const { unmount } = render(<GoldenExamView exam={generated} onBack={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'AI 重新出题' }))
    await waitFor(() => expect(generated.generateTasks).toHaveBeenCalled())
    expect(taskBox().open).toBe(false)
    unmount()

    const copied = fakeExam({ generateTasks: vi.fn().mockResolvedValue('copied') })
    render(<GoldenExamView exam={copied} onBack={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'AI 重新出题' }))
    await waitFor(() => expect(taskBox().open).toBe(true))
  })
})
