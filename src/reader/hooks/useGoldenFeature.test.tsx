// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { buildLocalGoldenLesson } from '../../core/golden'
import type { useGoldenDrill } from './useGoldenDrill'
import type { ReaderDoc } from './useReaderDoc'
import type { SavedArticle, Sentence } from '../../types/document'
import { useGoldenFeature } from './useGoldenFeature'

const sentence: Sentence = {
  id: 's1',
  paraId: 'p01',
  text: 'In response to the pandemic, remote collaboration has become the new norm.',
  audio: null,
  translation: null,
  grammarNote: null,
  collocations: [],
  vocab: [],
  tags: [],
  reviewState: { ease: 2.5, due: null, interval: 0, repetitions: 0 },
}

const doc: ReaderDoc = {
  paragraphs: [{ id: 'p01', sentenceIds: ['s1'] }],
  sentences: [sentence],
  golden: buildLocalGoldenLesson([sentence], undefined, { selected: ['s1'] }),
}

const saved: SavedArticle = {
  id: 'a1',
  title: 'A',
  sourceKey: null,
  text: sentence.text,
  paragraphs: doc.paragraphs,
  sentences: doc.sentences,
  golden: doc.golden,
  updatedAt: '2026-10-27T00:00:00.000Z',
}

describe('useGoldenFeature', () => {
  it('把去仿写 / 生成 / 金句本动作收成一个 actions 对象', () => {
    const close = vi.fn()
    const startWriting = vi.fn()
    const onGenerate = vi.fn()
    const golden = {
      lesson: doc.golden,
      close,
    } as unknown as ReturnType<typeof useGoldenDrill>
    const { result } = renderHook(() =>
      useGoldenFeature({
        golden,
        doc,
        articleTitle: 'A',
        articleKey: 'a1@x',
        articleIdentity: 'a1@x',
        savedId: 'a1',
        saved: [saved],
        records: [],
        writingHistory: [],
        setWritingHistory: vi.fn(),
        recordActivity: vi.fn(),
        download: vi.fn(),
        flash: vi.fn(),
        onGenerate,
        startWriting,
      }),
    )
    expect(result.current.actions.bank?.rows).toHaveLength(1)
    act(() => result.current.actions.onOpenWriting?.(['in response to']))
    expect(close).toHaveBeenCalled()
    expect(startWriting).toHaveBeenCalledWith({ model: sentence.text, mustUse: ['in response to'] })
    act(() => result.current.actions.onGenerate?.())
    expect(onGenerate).toHaveBeenCalled()
  })
})
