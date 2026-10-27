// @vitest-environment jsdom
import { useState } from 'react'
import { act, renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { useGoldenLesson } from './useGoldenLesson'
import type { ReaderDoc } from './useReaderDoc'
import type { GoldenDrillRecord } from '../../core/goldenProgress'
import type { Sentence } from '../../types/document'

const sentence = (id: string, text: string): Sentence => ({
  id,
  paraId: 'p01',
  text,
  audio: null,
  translation: null,
  grammarNote: null,
  collocations: [],
  vocab: [],
  tags: [],
  reviewState: { ease: 2.5, due: null, interval: 0, repetitions: 0 },
})

const initial: ReaderDoc = {
  paragraphs: [{ id: 'p01', sentenceIds: ['s1', 's2'] }],
  sentences: [
    sentence('s1', 'Team spirit is one of the main factors.'),
    sentence('s2', 'Remote collaboration has become the new norm.'),
  ],
}

function setup() {
  const flash = vi.fn()
  const setPendingSave = vi.fn()
  const hook = renderHook(() => {
    const [doc, setDoc] = useState<ReaderDoc | null>(initial)
    const records: GoldenDrillRecord[] = []
    const api = useGoldenLesson({ doc, articleId: 'a1', records, setDoc, setPendingSave, flash })
    return { api, doc }
  })
  return { ...hook, flash, setPendingSave }
}

describe('useGoldenLesson', () => {
  it('选全篇 / 手动取消会写回 doc.golden，并保持顺序', () => {
    const h = setup()
    act(() => h.result.current.api.setPick('all'))
    expect(h.result.current.doc?.golden?.selected).toEqual(['s1', 's2'])
    expect(h.result.current.api.ordered.map((s) => s.id)).toEqual(['s1', 's2'])
    expect(h.result.current.api.summary?.selectedSentences).toBe(2)
    expect(h.setPendingSave).toHaveBeenCalled()

    act(() => h.result.current.api.toggleSentence('s1'))
    expect(h.result.current.doc?.golden?.selected).toEqual(['s2'])
    expect(h.result.current.api.ordered.map((s) => s.id)).toEqual(['s2'])
  })

  it('去重开关只改选项，不丢已选句子', () => {
    const h = setup()
    act(() => h.result.current.api.setPick('all'))
    act(() => h.result.current.api.setDedupe(true))
    expect(h.result.current.doc?.golden?.options?.dedupe).toBe(true)
    expect(h.result.current.doc?.golden?.selected).toEqual(['s1', 's2'])
  })
})
