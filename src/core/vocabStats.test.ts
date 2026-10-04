import { describe, it, expect } from 'vitest'
import { dueForecast, last7Days, pickDayStats, sessionTotals, studyTotals, wordsByArticle } from './vocabStats'
import type { VocabItem } from '../types/document'

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

describe('sessionTotals', () => {
  it('累加词数与秒数', () => {
    expect(
      sessionTotals([
        { at: 'x', seconds: 10, picked: 3 },
        { at: 'y', seconds: 5, picked: 2 },
      ]),
    ).toEqual({ seconds: 15, picked: 5 })
  })
  it('空数组为 0', () => {
    expect(sessionTotals([])).toEqual({ seconds: 0, picked: 0 })
  })
})

describe('studyTotals', () => {
  it('累计 / 今日', () => {
    const days = [
      { day: '2026-10-04', seconds: 60, cards: 5 },
      { day: '2026-10-05', seconds: 30, cards: 2 },
    ]
    expect(studyTotals(days, '2026-10-05')).toEqual({ totalSeconds: 90, totalCards: 7, todaySeconds: 30 })
  })
})

describe('pickDayStats / last7Days', () => {
  const now = new Date(2026, 9, 5) // 2026-10-05
  const sessions = [
    { at: new Date(2026, 9, 5, 10).toISOString(), seconds: 0, picked: 4 },
    { at: new Date(2026, 9, 4, 10).toISOString(), seconds: 0, picked: 6 },
    { at: new Date(2026, 9, 3, 10).toISOString(), seconds: 0, picked: 1 },
  ]
  it('今日词数 + 连续天数', () => {
    expect(pickDayStats(sessions, now)).toEqual({ todayPicked: 4, streak: 3 })
  })
  it('今天没选则从昨天起算', () => {
    const s = [{ at: new Date(2026, 9, 4, 10).toISOString(), seconds: 0, picked: 6 }]
    expect(pickDayStats(s, now)).toEqual({ todayPicked: 0, streak: 1 })
  })
  it('最近 7 天按日期升序，含今天', () => {
    const out = last7Days(sessions, now)
    expect(out).toHaveLength(7)
    expect(out[6].key).toBe('2026-10-05')
    expect(out[6].picked).toBe(4)
    expect(out[5].key).toBe('2026-10-04')
    expect(out[0].key).toBe('2026-09-29')
  })
})

describe('dueForecast', () => {
  it('未来 N 天到期计数，首日标签「今天」', () => {
    const now = new Date(2026, 9, 5)
    const items = [
      mkItem({ reviewState: review(new Date(2026, 9, 5, 8).toISOString()) }),
      mkItem({ reviewState: review(new Date(2026, 9, 7, 8).toISOString()) }),
      mkItem({ reviewState: review(null) }),
    ]
    const out = dueForecast(items, now, 30)
    expect(out).toHaveLength(30)
    expect(out[0]).toEqual({ key: '2026-10-05', label: '今天', count: 1 })
    expect(out[2].count).toBe(1)
  })
})

describe('wordsByArticle', () => {
  it('按来源文章计数，取前 N', () => {
    const items = [
      mkItem({ word: 'a', source: { articleId: 'X', fileName: 'x', sentenceId: null, sentenceText: '' } }),
      mkItem({ word: 'b', source: { articleId: 'X', fileName: 'x', sentenceId: null, sentenceText: '' } }),
      mkItem({ word: 'c', source: { articleId: 'Y', fileName: 'y', sentenceId: null, sentenceText: '' } }),
      mkItem({ word: 'd' }),
    ]
    expect(wordsByArticle(items)).toEqual([
      ['X', 2],
      ['Y', 1],
      ['未标来源', 1],
    ])
  })
})
