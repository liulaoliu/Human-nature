// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { makeProductionTask } from '../../core/productionPrompts'
import type { WritingRecord } from '../../core/writing'
import { installFakeStorage } from '../testStorage'
import {
  PRODUCTION_LEGACY_BACKUP_KEY,
  PRODUCTION_LEGACY_REPORT_KEY,
  useProductionLegacyMigration,
} from './useProductionLegacyMigration'

function legacyRecord(at: string, topic = '工作'): WritingRecord {
  const task = makeProductionTask(
    { id: 'p1', zh: '跟同事说明进度', goal: '说明进度', targets: [] },
    topic,
    'full',
    's1',
  )
  return {
    at,
    articleId: 'A',
    articleTitle: 'A',
    model: task.model,
    text: 'I will follow up.',
    feedback: { version: 2, scores: [], total: 80, max: 100, issues: [], recommendations: [], polished: '', summary: '' },
    task: { ...task, sessionId: '' } as typeof task,
    source: 'production',
  }
}

let restore: () => void = () => {}
beforeEach(() => {
  restore = installFakeStorage()
  localStorage.clear()
})
afterEach(() => restore())

describe('useProductionLegacyMigration：迁移报告', () => {
  it('归组后写备份与报告，并暴露每组明细', async () => {
    const setRecords = vi.fn()
    const flash = vi.fn()
    const records = [legacyRecord('2026-11-01T10:00:00.000Z'), legacyRecord('2026-11-01T11:00:00.000Z')]
    const { result } = renderHook(() =>
      useProductionLegacyMigration({ records, setRecords, flash }),
    )

    await waitFor(() => expect(setRecords).toHaveBeenCalled())
    expect(result.current.report?.changed).toBe(2)
    expect(result.current.report?.groups).toEqual([
      expect.objectContaining({ articleId: 'A', day: '2026-11-01', count: 2, mode: 'full' }),
    ])
    expect(localStorage.getItem(PRODUCTION_LEGACY_BACKUP_KEY)).toBeTruthy()
    expect(localStorage.getItem(PRODUCTION_LEGACY_REPORT_KEY)).toBeTruthy()
    expect(flash).toHaveBeenCalledWith(expect.stringContaining('归成 1 组'))
  })
})
