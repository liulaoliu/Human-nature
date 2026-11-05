// @vitest-environment jsdom
import { useState } from 'react'
import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createLibrary } from '../../core/vocab'
import { sentenceFixture, vocabItem } from '../../core/testFixtures'
import type { WritingRecord } from '../../core/writing'
import type { VocabLibrary } from '../../types/document'
import { installFakeStorage } from '../testStorage'
import { useProductionSession } from './useProductionSession'

const packRaw = JSON.stringify({
  prompts: [{ zh: '跟同事说明你下午会跟进。', goal: '说明进度', targetIds: ['v1|self|word'] }],
})
const feedbackRaw = JSON.stringify({
  version: 2,
  scores: [{ dimension: '意思', score: 40, max: 40 }],
  total: 40,
  max: 40,
  issues: [],
  recommendations: [],
  polished: 'I will follow up this afternoon.',
  summary: '表达清楚。',
})

let restore: () => void = () => {}
beforeEach(() => {
  restore = installFakeStorage()
  localStorage.clear()
})

afterEach(() => {
  restore()
})

const library: VocabLibrary = {
  ...createLibrary(),
  items: [
    vocabItem({
      id: 'v1',
      word: 'run',
      lemma: 'run',
      meaning: '跑',
      source: { articleId: 'A', fileName: 'A', sentenceId: null, sentenceText: '' },
    }),
  ],
}

function setup(configured = true) {
  let records: WritingRecord[] = []
  const runAi = vi.fn(async (jobs: { task: string }[]) => ({
    results: [{ id: 'x', task: jobs[0].task, raw: jobs[0].task === 'feedback' ? feedbackRaw : packRaw }],
    failed: [],
    dropped: 0,
  }))
  const flash = vi.fn()
  const recordActivity = vi.fn()
  const hook = renderHook(() => {
    const [writingHistory, setWritingHistory] = useState<WritingRecord[]>([])
    records = writingHistory
    return useProductionSession({
      doc: { paragraphs: [], sentences: [sentenceFixture('s1', 'I run daily.')] },
      library,
      articleIdentity: 'A',
      articleTitle: 'A',
      writingHistory,
      setWritingHistory,
      recordActivity,
      flash,
      runAi: runAi as never,
      aiStatus: async () => configured,
      now: () => new Date('2026-11-05T10:00:00.000Z'),
    })
  })
  return { ...hook, runAi, flash, recordActivity, getRecords: () => records }
}

describe('useProductionSession：出题 → 作答 → 批改 → 重写', () => {
  it('AI 出中文题；作答后批改落 writingHistory，重写后才进下一题', async () => {
    const h = setup()
    act(() => h.result.current.openProduction())
    act(() =>
      h.result.current.updateSettings({
        topic: '工作沟通',
        scope: 'all',
        types: ['word'],
        promptCount: 3,
        targetsPerPrompt: 1,
        weakRatio: 0,
      }),
    )
    await act(async () => {
      await h.result.current.start()
    })
    expect(h.result.current.stage).toBe('playing')
    expect(h.result.current.prompts).toHaveLength(1)
    expect(h.result.current.current?.zh).toContain('跟进')

    act(() => h.result.current.setAnswer('I run daily.'))
    await act(async () => {
      await h.result.current.grade()
    })
    expect(h.result.current.feedback?.total).toBe(40)
    expect(h.result.current.hits[0].used).toBe(true)
    expect(h.getRecords()).toHaveLength(1)
    expect(h.getRecords()[0].source).toBe('production')

    act(() => h.result.current.next())
    expect(h.result.current.stage).toBe('playing')
    expect(h.runAi).toHaveBeenCalledTimes(2)

    act(() => h.result.current.rewrite())
    expect(h.result.current.round).toBe(2)
    act(() => h.result.current.setAnswer('I run every day.'))
    await act(async () => {
      await h.result.current.grade()
    })
    expect(h.getRecords()).toHaveLength(2)

    act(() => h.result.current.next())
    expect(h.result.current.stage).toBe('done')
  })

  it('没配 AI：走复制 / 粘回，不丢用户草稿', async () => {
    const copy = vi.fn(async () => {})
    Object.assign(navigator, { clipboard: { writeText: copy } })
    const h = setup(false)
    act(() => h.result.current.openProduction())
    act(() =>
      h.result.current.updateSettings({
        topic: '工作沟通',
        scope: 'all',
        types: ['word'],
        promptCount: 3,
        targetsPerPrompt: 1,
      }),
    )
    await act(async () => {
      await h.result.current.start()
    })
    expect(h.result.current.pasteKind).toBe('pack')
    expect(copy).toHaveBeenCalled()

    act(() => h.result.current.applyPaste(packRaw))
    expect(h.result.current.current?.zh).toContain('跟进')
    act(() => h.result.current.setAnswer('I run daily.'))
    await act(async () => {
      await h.result.current.grade()
    })
    expect(h.result.current.pasteKind).toBe('feedback')
    act(() => h.result.current.applyPaste(feedbackRaw))
    expect(h.getRecords()).toHaveLength(1)
    expect(h.getRecords()[0].text).toBe('I run daily.')
  })
})
