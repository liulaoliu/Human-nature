// @vitest-environment jsdom
import { useState } from 'react'
import { act, renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { useGoldenExam } from './useGoldenExam'
import { goldenDrillKey, goldenTargetsFor } from '../../core/golden'
import type { GoldenDrillRecord } from '../../core/goldenProgress'
import type { WritingRecord } from '../../core/writing'
import type { GoldenLesson, Sentence } from '../../types/document'
import type { ReaderDoc } from './useReaderDoc'

const texts = [
  'In response to the pandemic, remote collaboration has become the new norm.',
  'Team spirit is one of the main factors that contribute to success.',
  'The committee will examine the draft before the board makes a decision.',
  'Small habits can make a big difference over a long period of time.',
  'The report shows that the new policy has improved public health.',
]

const sentences: Sentence[] = texts.map((text, i) => ({
  id: `s${i + 1}`,
  paraId: 'p01',
  text,
  audio: null,
  translation: `译文${i + 1}`,
  grammarNote: null,
  collocations: [],
  vocab: [],
  tags: [],
  reviewState: { ease: 2.5, due: null, interval: 0, repetitions: 0 },
}))

const lesson: GoldenLesson = {
  version: 1,
  source: 'local',
  outline: [],
  sentences: sentences.map((s, i) => ({
    id: s.id,
    zh: s.translation ?? undefined,
    pattern: i === 0 ? 'In response to + n., … has become …' : undefined,
    targets: [{ en: s.text.split(' ').slice(0, 2).join(' '), kind: 'collocation' }],
  })),
  selected: sentences.map((s) => s.id),
  options: { examAfter: 5 },
}

const records: GoldenDrillRecord[] = sentences.map((s, i) => {
  const t = goldenTargetsFor(lesson, s.id)
  return {
    id: `r${i}`,
    articleId: 'a1',
    sentenceId: s.id,
    drillKey: goldenDrillKey(s.text, t),
    at: '2026-10-27T00:00:00.000Z',
    fillTries: 1,
    assembleTries: 1,
    recallTries: 0,
    summarySeen: true,
    mastered: false,
  }
})

const feedback = {
  version: 2,
  scores: [{ dimension: '结构运用', score: 30, max: 35 }],
  total: 85,
  max: 100,
  issues: [
    {
      original: 'has improved',
      suggestion: 'improved',
      reason: '时态',
      rule: 'tense-choice',
      key: 'tense-choice',
      severity: 'must-fix',
    },
  ],
  polished: 'The new policy has improved public health.',
  summary: '注意主谓一致。',
}

function setup(runAi = vi.fn(), aiStatus = vi.fn().mockResolvedValue(true)) {
  const setPendingSave = vi.fn()
  const flash = vi.fn()
  const recordActivity = vi.fn()
  const hook = renderHook(() => {
    const [doc, setDoc] = useState<ReaderDoc | null>({
      paragraphs: [{ id: 'p01', sentenceIds: sentences.map((s) => s.id) }],
      sentences,
      golden: lesson,
    })
    const [history, setWritingHistory] = useState<WritingRecord[]>([])
    const exam = useGoldenExam({
      doc,
      lesson: doc?.golden ?? null,
      articleId: 'a1',
      articleTitle: 'A',
      records,
      writingHistory: history,
      setWritingHistory,
      setDoc,
      setPendingSave,
      flash,
      recordActivity,
      runAi,
      aiStatus,
      now: () => new Date('2026-10-28T00:00:00.000Z'),
    })
    return { exam, doc, history }
  })
  return { ...hook, setPendingSave, flash, recordActivity, runAi, aiStatus }
}

describe('useGoldenExam', () => {
  it('完成 5 句解锁；本地出题写回课程', () => {
    const h = setup()
    expect(h.result.current.exam.unlocked).toBe(true)
    expect(h.result.current.exam.items).toHaveLength(5)
    act(() => h.result.current.exam.start())
    expect(h.result.current.exam.index).toBe(0)
    expect(h.result.current.doc?.golden?.exam).toHaveLength(5)
    expect(h.setPendingSave).toHaveBeenCalledWith(true)
  })

  it('AI 出题结果写回；坏 JSON 不落库', () => {
    const raw = JSON.stringify({
      items: [
        {
          sentenceId: 's1',
          task: '用这个结构写一句关于环保的新句子。',
          structure: 'In response to + n., … has become …',
          mustUse: ['In response'],
          rubric: [{ dimension: '结构运用', weight: 100 }],
        },
      ],
    })
    const runAi = vi.fn().mockResolvedValue({ results: [{ id: 'x', task: 'golden_exam', raw }], failed: [], dropped: 0 })
    const h = setup(runAi)
    act(() => h.result.current.exam.start())
    act(() => {
      h.result.current.exam.applyTasks('bad')
    })
    expect(h.result.current.exam.error).toContain('没解析出考试题')
    act(() => {
      h.result.current.exam.applyTasks(raw)
    })
    expect(h.result.current.exam.items).toHaveLength(1)
    expect(h.result.current.doc?.golden?.exam?.[0].source).toBe('ai')
  })

  it('AI 批改：写入仿写历史，来源标记 goldenExam', async () => {
    const raw = JSON.stringify(feedback)
    const runAi = vi.fn().mockResolvedValue({ results: [{ id: 'x', task: 'feedback', raw }], failed: [], dropped: 0 })
    const h = setup(runAi)
    act(() => h.result.current.exam.start())
    act(() => h.result.current.exam.setAnswer('The new policy has improved public health.'))
    await act(async () => {
      await h.result.current.exam.grade()
    })
    await waitFor(() => expect(h.result.current.exam.feedback?.total).toBe(85))
    expect(h.result.current.history).toHaveLength(1)
    expect(h.result.current.history[0].source).toBe('goldenExam')
    expect(h.result.current.history[0].articleId).toBe('a1')
    expect(h.result.current.exam.feedback?.issues[0].suggestion).toBe('improved')
    expect(h.recordActivity).toHaveBeenCalledWith('write', 1)
  })
})
