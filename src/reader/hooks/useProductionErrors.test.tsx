// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { renderHook } from '@testing-library/react'
import type { WritingRecord } from '../../core/writing'
import { makeProductionTask } from '../../core/productionPrompts'
import { useProductionErrors } from './useProductionErrors'

const record: WritingRecord = {
  at: '2026-11-01T10:00:00.000Z',
  articleId: 'A',
  model: '',
  text: 'I saw cat.',
  feedback: {
    version: 2,
    scores: [],
    total: 70,
    max: 100,
    issues: [
      {
        rule: 'article-missing',
        key: 'cat',
        original: 'saw cat',
        suggestion: 'saw a cat',
        reason: '可数名词单数前缺冠词',
        severity: 'must-fix',
        type: 'article',
      },
    ],
    recommendations: [],
    polished: '',
    summary: '',
  },
  task: makeProductionTask(
    { id: 'p1', zh: '我看见了猫。', goal: '描述', targets: [] },
    '日常',
    'full',
    's1',
  ),
  source: 'production',
}

describe('useProductionErrors：产出错因进复习卡', () => {
  it('must-fix 错因补一行 writingErrorProgress', () => {
    const setProgress = vi.fn()
    renderHook(() =>
      useProductionErrors({
        records: [record],
        writingErrorProgress: [],
        setWritingErrorProgress: setProgress,
        now: () => new Date('2026-11-05T10:00:00.000Z'),
      }),
    )
    expect(setProgress).toHaveBeenCalled()
    const next = setProgress.mock.calls[0][0] as { id: string }[]
    expect(next[0].id).toBe('errfix:article-missing|cat')
  })

  it('同一错因内容更新时也会写回，不只新增', () => {
    const setProgress = vi.fn()
    const old = {
      id: 'errfix:article-missing|cat',
      rule: 'article-missing' as const,
      key: 'cat',
      articleId: 'A',
      original: 'old',
      suggestion: 'old suggestion',
      status: 'active' as const,
      streak: 2,
      reviews: 3,
      createdAt: '2026-10-01T00:00:00.000Z',
      updatedAt: '2026-10-01T00:00:00.000Z',
    }
    renderHook(() =>
      useProductionErrors({
        records: [record],
        writingErrorProgress: [old],
        setWritingErrorProgress: setProgress,
        now: () => new Date('2026-11-05T10:00:00.000Z'),
      }),
    )
    expect(setProgress).toHaveBeenCalled()
    const next = setProgress.mock.calls[0][0] as { suggestion: string }[]
    expect(next[0].suggestion).toBe('saw a cat')
  })
})
