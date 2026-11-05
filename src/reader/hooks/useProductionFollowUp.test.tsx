// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import type { WritingFeedback } from '../../core/writing'
import { useProductionFollowUp } from './useProductionFollowUp'

const feedback: WritingFeedback = {
  version: 2,
  scores: [],
  total: 70,
  max: 100,
  issues: [],
  recommendations: [],
  polished: '',
  summary: '整体可以。',
}

describe('useProductionFollowUp：批改后追问', () => {
  it('带题面 / 作答 / 批改调用 AI，返回一问一答', async () => {
    const callAi = vi.fn(async (_task: string, _prompt: string) => '这里用 a 更自然。')
    const { result } = renderHook(() =>
      useProductionFollowUp({
        current: { id: 'p1', zh: '我看见了猫。', goal: '描述', targets: [] },
        answer: 'I saw cat.',
        feedback,
        ensureAi: async () => true,
        callAi,
        flash: vi.fn(),
      }),
    )
    await act(async () => {
      await result.current.ask('为什么加 a？')
    })
    expect(callAi).toHaveBeenCalled()
    expect(String(callAi.mock.calls[0][1])).toContain('为什么加 a？')
    expect(result.current.items).toEqual([{ q: '为什么加 a？', a: '这里用 a 更自然。' }])
    expect(result.current.asking).toBe(false)
  })
})
