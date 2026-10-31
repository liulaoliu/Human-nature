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
      extraPointsFor: () => [],
      bySentence: new Map([['s1', sentence]]),
      addExtraPoint: vi.fn(),
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
        answerEvents: [],
        recordAnswer: vi.fn(),
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

  it('单句仿写题跟随当前句，不依赖整课考试解锁', () => {
    const golden = {
      lesson: doc.golden,
      currentSentence: sentence,
      articleId: 'a1',
      phase: 'imitation',
      close: vi.fn(),
      setDoc: vi.fn(),
      setPendingSave: vi.fn(),
      extraPointsFor: () => [],
      bySentence: new Map([['s1', sentence]]),
      addExtraPoint: vi.fn(),
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
        answerEvents: [],
        recordAnswer: vi.fn(),
        recordActivity: vi.fn(),
        download: vi.fn(),
        flash: vi.fn(),
        onGenerate: vi.fn(),
        startWriting: vi.fn(),
      }),
    )
    expect(result.current.sentenceImitation.current?.sentenceId).toBe('s1')
    expect(result.current.sentenceImitation.current?.model).toBe(sentence.text)
  })

  it('错因复盘：复习写 answerEvent；推荐加入本课映射成 extraPoint', () => {
    const recordAnswer = vi.fn()
    const recordActivity = vi.fn()
    const addExtraPoint = vi.fn()
    const golden = {
      lesson: doc.golden,
      articleId: 'a1',
      close: vi.fn(),
      extraPointsFor: () => [],
      bySentence: new Map([['s1', sentence]]),
      addExtraPoint,
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
        answerEvents: [],
        recordAnswer,
        recordActivity,
        download: vi.fn(),
        flash: vi.fn(),
        onGenerate: vi.fn(),
        startWriting: vi.fn(),
      }),
    )
    const card = {
      id: 'errfix:word-spelling|spelling-bureaucracy',
      rule: 'word-spelling' as const,
      type: 'spelling' as const,
      key: 'spelling-bureaucracy',
      original: 'bureacracy',
      suggestion: 'bureaucracy',
      text: 'I learn bureacracy.',
      recordKey: 'r1',
      at: '2026-10-30T00:00:00.000Z',
      articleId: 'a1',
      sentenceId: 's1',
    }
    act(() => result.current.actions.errors?.onReviewAnswer?.(card, true))
    expect(recordAnswer).toHaveBeenCalledWith({
      articleId: 'a1',
      source: 'golden',
      kind: 'error-fix',
      cat: 'write',
      correct: true,
      questionId: card.id,
    })
    expect(recordActivity).toHaveBeenCalledWith('write', 1)

    act(() =>
      result.current.actions.errors?.onAddPoint?.({
        kind: 'chunk',
        point: 'come to an end',
        pointKey: 'chunk-come-to-an-end',
        why: '常错',
        priority: 1,
        from: 'error',
        issueKey: 'chunk-come-to-an-end',
        articleId: 'a1',
        sentenceId: 's1',
        count: 1,
        lastAt: '2026-10-30T00:00:00.000Z',
      }),
    )
    expect(addExtraPoint).toHaveBeenCalledWith(
      expect.objectContaining({ sentenceId: 's1', en: 'come to an end', kind: 'chunk' }),
    )
  })
})
