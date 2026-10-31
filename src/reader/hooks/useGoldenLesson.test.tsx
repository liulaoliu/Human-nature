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

  it('去重 / 填空单位开关只改选项，不丢已选句子', () => {
    const h = setup()
    act(() => h.result.current.api.setPick('all'))
    act(() => h.result.current.api.setDedupe(true))
    act(() => h.result.current.api.setBlankUnit('target'))
    expect(h.result.current.doc?.golden?.options?.dedupe).toBe(true)
    expect(h.result.current.doc?.golden?.options?.blankUnit).toBe('target')
    expect(h.result.current.doc?.golden?.selected).toEqual(['s1', 's2'])
  })

  it('加入本课写 extraPoints，不动 targets；重复 / 不存在的句子拒绝', () => {
    const h = setup()
    act(() => h.result.current.api.setPick('all'))
    const targetsBefore = JSON.stringify(h.result.current.doc?.golden?.sentences[0].targets)
    act(() =>
      h.result.current.api.addExtraPoint({
        sentenceId: 's1',
        en: 'come to an end',
        zh: '结束',
        kind: 'chunk',
      }),
    )
    expect(h.result.current.doc?.golden?.extraPoints).toHaveLength(1)
    expect(h.result.current.api.extraPointsFor('s1').map((p) => p.en)).toEqual(['come to an end'])
    expect(JSON.stringify(h.result.current.doc?.golden?.sentences[0].targets)).toBe(targetsBefore)

    act(() =>
      h.result.current.api.addExtraPoint({
        sentenceId: 's1',
        en: '  come  to an end ',
        kind: 'chunk',
      }),
    )
    expect(h.result.current.doc?.golden?.extraPoints).toHaveLength(1)
    expect(h.flash).toHaveBeenCalledWith('这个语言点已经在本课里了')

    act(() =>
      h.result.current.api.addExtraPoint({ sentenceId: 's404', en: 'x', kind: 'chunk' }),
    )
    expect(h.flash).toHaveBeenCalledWith('这个语言点对应的句子不在当前文章里')

    act(() => h.result.current.api.removeExtraPoint('s1', 'come to an end'))
    expect(h.result.current.doc?.golden?.extraPoints).toBeUndefined()
  })
})
