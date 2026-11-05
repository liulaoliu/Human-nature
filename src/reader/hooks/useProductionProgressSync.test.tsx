// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { renderHook } from '@testing-library/react'
import type { ProductionTarget } from '../../core/production'
import { makeProductionTask } from '../../core/productionPrompts'
import type { WritingRecord } from '../../core/writing'
import { useProductionProgressSync } from './useProductionProgressSync'

const target: ProductionTarget = { id: 'v1', itemId: 'v1', kind: 'word', text: 'run', meaning: '跑' }
const task = makeProductionTask({ id: 'p1', zh: '跑步', goal: '', targets: [target] }, '日常', 'full', 's1')
const record: WritingRecord = {
  at: '2026-11-05T10:00:00.000Z',
  articleId: 'A',
  model: '',
  text: 'I run.',
  feedback: {
    version: 2,
    scores: [],
    total: 80,
    max: 100,
    issues: [],
    recommendations: [],
    polished: '',
    summary: '',
  },
  task: { ...task, hits: [{ ...target, used: true }] } as unknown as WritingRecord['task'],
  source: 'production',
}

describe('useProductionProgressSync：目标块进度落表', () => {
  it('历史 attempts 变化时把派生进度交给 setter', () => {
    const setStored = vi.fn()
    renderHook(() => useProductionProgressSync({ records: [record], setStored }))
    expect(setStored).toHaveBeenCalled()
    const rows = setStored.mock.calls[0][0] as { key: string; attempts: number }[]
    expect(rows[0]).toMatchObject({ key: 'word:run', attempts: 1 })
  })
})
