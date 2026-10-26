// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { renderHook } from '@testing-library/react'
import type { SavedArticle, VocabItem } from '../../types/document'
import type { WritingRecord } from '../../core/writing'
import type { BatchItem } from '../panels/SidePick'
import { useReaderDerived, type ReaderDerivedInput } from './useReaderDerived'

const review = (due: string | null = null) => ({ ease: 2.5, due, interval: 0, repetitions: 0 })

const mkItem = (over: Partial<VocabItem> = {}): VocabItem => ({
  id: over.word ?? 'w',
  word: 'word',
  lemma: 'word',
  phonetic: null,
  partOfSpeech: null,
  meaning: null,
  usage: [],
  examples: [],
  source: null,
  status: 'queried',
  note: '',
  tags: [],
  reviewState: review(),
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  ...over,
})

const mkSaved = (id: string, book?: string): SavedArticle => ({
  id,
  title: id,
  book,
  sourceKey: null,
  text: '',
  paragraphs: [],
  sentences: [],
  updatedAt: '2026-01-01T00:00:00.000Z',
})

const mkWrite = (at: string): WritingRecord => ({
  at,
  articleId: 'a',
  model: 'M',
  text: 'T',
  feedback: { scores: [], issues: [], total: 0, max: 0 },
})

const NOW = new Date(2026, 9, 20, 10, 0) // 2026-10-20 10:00 本地

const input = (over: Partial<ReaderDerivedInput> = {}): ReaderDerivedInput => ({
  items: [],
  sessions: [],
  studyDays: [],
  studyUnflushed: 0,
  todayKey: '2026-10-20',
  writingHistory: [],
  saved: [],
  confusableBatchSize: 60,
  batch: [],
  libraryLemmas: new Set<string>(),
  now: NOW,
  ...over,
})

describe('useReaderDerived 汇总', () => {
  it('选词会话累计 + 背词累计 / 今日 / 未落盘叠加', () => {
    const { result } = renderHook(() =>
      useReaderDerived(
        input({
          sessions: [
            { at: new Date(2026, 9, 20, 9).toISOString(), seconds: 100, picked: 3 },
            { at: new Date(2026, 9, 19, 9).toISOString(), seconds: 50, picked: 2 },
          ],
          studyDays: [
            { day: '2026-10-19', seconds: 40, cards: 2 },
            { day: '2026-10-20', seconds: 60, cards: 5 },
          ],
          studyUnflushed: 15,
        }),
      ),
    )
    expect(result.current.totals).toEqual({ seconds: 150, picked: 5 })
    expect(result.current.studyStats).toEqual({ totalSeconds: 100, totalCards: 7, todaySeconds: 60 })
    expect(result.current.todayCards).toBe(5)
    expect(result.current.studyGrandSeconds).toBe(115)
    expect(result.current.dayStats).toEqual({ todayPicked: 3, streak: 2 })
    expect(result.current.last7).toHaveLength(7)
    expect(result.current.last7[6]).toMatchObject({ key: '2026-10-20', picked: 3 })
  })

  it('今日写作条数按逻辑日算，坏时间戳忽略', () => {
    const { result } = renderHook(() =>
      useReaderDerived(
        input({
          writingHistory: [
            mkWrite(new Date(2026, 9, 20, 9).toISOString()),
            mkWrite(new Date(2026, 9, 20, 2).toISOString()), // 04:00 结算 → 算 10-19
            mkWrite(new Date(2026, 9, 19, 9).toISOString()),
            mkWrite('不是时间'),
          ],
        }),
      ),
    )
    expect(result.current.todayWrites).toBe(1)
  })

  it('savedGroups 按书分组，没标的归「单篇」', () => {
    const { result } = renderHook(() =>
      useReaderDerived(
        input({
          saved: [mkSaved('a', '书一'), mkSaved('b'), mkSaved('c', '书一')],
        }),
      ),
    )
    expect(result.current.savedGroups).toEqual([
      ['书一', [expect.objectContaining({ id: 'a' }), expect.objectContaining({ id: 'c' })]],
      ['单篇', [expect.objectContaining({ id: 'b' })]],
    ])
  })

  it('到期预测按未来 30 天，首日标「今天」', () => {
    const { result } = renderHook(() =>
      useReaderDerived(
        input({ items: [mkItem({ reviewState: review(new Date(2026, 9, 20, 8).toISOString()) })] }),
      ),
    )
    expect(result.current.dueForecastRows).toHaveLength(30)
    expect(result.current.dueForecastRows[0]).toMatchObject({ key: '2026-10-20', label: '今天', count: 1 })
  })
})

describe('useReaderDerived AI 候选', () => {
  it('confusableTodo 只留「有释义、还没混淆项的单词」；批量 0 = 全量，N = 截断', () => {
    const items = [
      mkItem({ word: 'a', meaning: '甲' }),
      mkItem({ word: 'b', meaning: '乙' }),
      mkItem({ word: 'c', meaning: '丙', confusables: [{ word: 'x', meaning: '叉' }] }),
      mkItem({ word: 'd', meaning: null }),
      mkItem({ word: 'take off', lemma: 'take off', meaning: '词组', kind: 'phrase' }),
    ]
    const { result, rerender } = renderHook((p: ReaderDerivedInput) => useReaderDerived(p), {
      initialProps: input({ items, confusableBatchSize: 1 }),
    })
    expect(result.current.confusableTodo.map((i) => i.word)).toEqual(['a', 'b'])
    expect(result.current.confusableBatch.map((i) => i.word)).toEqual(['a'])

    rerender(input({ items, confusableBatchSize: 0 }))
    expect(result.current.confusableBatch.map((i) => i.word)).toEqual(['a', 'b'])
  })

  it('lemmaCandidates 只留 word 与 lemma 不一致的单词；posCandidates 含 -ing/-ed', () => {
    const items = [
      mkItem({ word: 'run', lemma: 'run' }),
      mkItem({ word: 'running', lemma: 'run' }),
      mkItem({ word: 'walked', lemma: 'walked' }),
      mkItem({ word: 'phrased up', lemma: 'phrased up', kind: 'phrase' }),
    ]
    const { result } = renderHook(() => useReaderDerived(input({ items })))
    expect(result.current.lemmaCandidates.map((i) => i.word)).toEqual(['running'])
    expect(result.current.posCandidates.map((i) => i.word).sort()).toEqual(['running', 'walked'])
  })

  it('byArticle 按来源文章统计前 10', () => {
    const { result } = renderHook(() =>
      useReaderDerived(
        input({
          items: [
            mkItem({ word: 'a', source: { articleId: 'A', sentenceId: null, sentenceText: '', fileName: '' } }),
            mkItem({ word: 'b', source: { articleId: 'A', sentenceId: null, sentenceText: '', fileName: '' } }),
            mkItem({ word: 'c', source: { articleId: 'B', sentenceId: null, sentenceText: '', fileName: '' } }),
          ],
        }),
      ),
    )
    expect(result.current.byArticle).toEqual([
      ['A', 2],
      ['B', 1],
    ])
  })
})

describe('useReaderDerived 待选', () => {
  it('visibleBatch 隐藏已入词库的 lemma（按词形还原后比较）', () => {
    const batch: BatchItem[] = [
      { word: 'running', sentence: 's1', sentenceId: null },
      { word: 'quiet', sentence: 's2', sentenceId: null },
    ]
    const { result } = renderHook(() => useReaderDerived(input({ batch, libraryLemmas: new Set(['run']) })))
    expect(result.current.visibleBatch.map((b) => b.word)).toEqual(['quiet'])
  })
})

describe('useReaderDerived 记忆化', () => {
  it('输入引用不变时复用上一次结果', () => {
    const props = input({ items: [mkItem({ word: 'a', meaning: '甲' })] })
    const { result, rerender } = renderHook(() => useReaderDerived(props))
    const first = result.current.confusableTodo
    rerender()
    expect(result.current.confusableTodo).toBe(first)
  })
})
