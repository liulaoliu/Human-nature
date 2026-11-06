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
  it('收到 storage 事件时把同一篇文章同一模式的草稿交给调用方', () => {
    const onRemote = vi.fn()
    renderHook(() => useProductionDraft('A', 'full', onRemote))
    act(() => {
      window.dispatchEvent(
        new StorageEvent('storage', {
          key: PRODUCTION_DRAFT_KEY,
          newValue: JSON.stringify({ 'A::full': draft }),
        }),
      )
    })
    expect(onRemote).toHaveBeenCalledWith(draft)
  })

  it('别的文章 / 别的吃法的草稿不回调', () => {
    const onRemote = vi.fn()
    renderHook(() => useProductionDraft('A', 'full', onRemote))
    act(() => {
      window.dispatchEvent(
        new StorageEvent('storage', {
          key: PRODUCTION_DRAFT_KEY,
          newValue: JSON.stringify({
            'B::full': { ...draft, articleId: 'B' },
            'A::yogurt': { ...draft, mode: 'yogurt' },
          }),
        }),
      )
    })
    expect(onRemote).not.toHaveBeenCalled()
  })
})

it('本地已有较新草稿时，旧 save 不覆盖', () => {
  const { result } = renderHook(() => useProductionDraft('A', 'full'))
  const newer = { ...draft, at: '2026-11-06T00:00:00.000Z', answer: 'newer' }
  const older = { ...draft, at: '2026-11-05T00:00:00.000Z', answer: 'older' }
  localStorage.setItem(PRODUCTION_DRAFT_KEY, JSON.stringify({ 'A::full': newer }))
  act(() => result.current.save(older))
  const stored = JSON.parse(localStorage.getItem(PRODUCTION_DRAFT_KEY) ?? '{}') as Record<
    string,
    { answer: string }
  >
  expect(stored['A::full'].answer).toBe('newer')
})

describe('useProductionDraft：三种吃法各存各的', () => {
  it('酸奶暂停的草稿不被全脂覆盖，清草稿也只清自己那组', () => {
    const { result } = renderHook(() => useProductionDraft('A', 'full'))
    const yogurtDraft: ProductionDraft = {
      ...draft,
      mode: 'yogurt',
      at: '2026-11-06T10:00:00.000Z',
      answer: 'yogurt 停在第 32 题',
    }
    const fullDraft: ProductionDraft = {
      ...draft,
      mode: 'full',
      at: '2026-11-06T11:00:00.000Z',
      answer: 'full 新的一组',
    }
    act(() => result.current.save(yogurtDraft))
    act(() => result.current.save(fullDraft))

    let stored = JSON.parse(localStorage.getItem(PRODUCTION_DRAFT_KEY) ?? '{}') as Record<
      string,
      ProductionDraft
    >
    expect(Object.keys(stored).sort()).toEqual(['A::full', 'A::yogurt'])
    expect(stored['A::yogurt'].answer).toBe('yogurt 停在第 32 题')

    // 开始全脂只清全脂那组；酸奶那组还在
    act(() => result.current.clearFor('full'))
    stored = JSON.parse(localStorage.getItem(PRODUCTION_DRAFT_KEY) ?? '{}') as Record<
      string,
      ProductionDraft
    >
    expect(Object.keys(stored)).toEqual(['A::yogurt'])
  })

  it('listMine 列出这篇文章各组草稿，最新的排前面', () => {
    const { result } = renderHook(() => useProductionDraft('A', 'full'))
    act(() => result.current.save({ ...draft, mode: 'yogurt', at: '2026-11-06T09:00:00.000Z' }))
    act(() => result.current.save({ ...draft, mode: 'full', at: '2026-11-06T12:00:00.000Z' }))
    act(() => result.current.save({ ...draft, articleId: 'B', at: '2026-11-06T13:00:00.000Z' }))
    const mine = result.current.listMine()
    expect(mine.map((d) => d.mode)).toEqual(['full', 'yogurt'])
    expect(result.current.loadNewest()?.mode).toBe('full')
  })
})
