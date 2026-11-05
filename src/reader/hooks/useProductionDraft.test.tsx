// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { PRODUCTION_DRAFT_KEY, type ProductionDraft } from '../../core/productionDraft'
import { installFakeStorage } from '../testStorage'
import { useProductionDraft } from './useProductionDraft'

const draft: ProductionDraft = {
  version: 1,
  sessionId: 's1',
  articleId: 'A',
  at: '2026-11-05T10:00:00.000Z',
  mode: 'full',
  sessionTopic: '随机',
  prompts: [{ id: 'p1', zh: '说明进度', goal: '', targets: [] }],
  index: 0,
  answer: 'draft',
  feedback: null,
  previousFeedback: null,
  hits: [],
  round: 1,
  notice: '',
}

let restore: () => void = () => {}
beforeEach(() => {
  restore = installFakeStorage()
})
afterEach(() => {
  restore()
  vi.restoreAllMocks()
})

describe('useProductionDraft：多标签页草稿', () => {
  it('收到 storage 事件时把新草稿交给调用方', () => {
    const onRemote = vi.fn()
    renderHook(() => useProductionDraft('A', onRemote))
    act(() => {
      window.dispatchEvent(
        new StorageEvent('storage', {
          key: PRODUCTION_DRAFT_KEY,
          newValue: JSON.stringify({ A: draft }),
        }),
      )
    })
    expect(onRemote).toHaveBeenCalledWith(draft)
  })

  it('别的文章的草稿不回调', () => {
    const onRemote = vi.fn()
    renderHook(() => useProductionDraft('A', onRemote))
    act(() => {
      window.dispatchEvent(
        new StorageEvent('storage', {
          key: PRODUCTION_DRAFT_KEY,
          newValue: JSON.stringify({ B: { ...draft, articleId: 'B' } }),
        }),
      )
    })
    expect(onRemote).not.toHaveBeenCalled()
  })
})

it('本地已有较新草稿时，旧 save 不覆盖', () => {
  const { result } = renderHook(() => useProductionDraft('A'))
  const newer = { ...draft, at: '2026-11-06T00:00:00.000Z', answer: 'newer' }
  const older = { ...draft, at: '2026-11-05T00:00:00.000Z', answer: 'older' }
  localStorage.setItem(PRODUCTION_DRAFT_KEY, JSON.stringify({ A: newer }))
  act(() => result.current.save(older))
  const stored = JSON.parse(localStorage.getItem(PRODUCTION_DRAFT_KEY) ?? '{}') as Record<string, { answer: string }>
  expect(stored.A.answer).toBe('newer')
})
