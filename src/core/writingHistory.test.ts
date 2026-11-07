import { describe, expect, it } from 'vitest'
import type { WritingRecord } from './writing'
import {
  filterWritingHistory,
  removeWritingHistory,
  writingHistoryCounts,
  writingHistorySourceOf,
  type WritingHistoryFilter,
} from './writingHistory'

const feedback = {
  version: 2 as const,
  scores: [],
  total: 8,
  max: 10,
  issues: [],
}

function record(over: Partial<WritingRecord> = {}): WritingRecord {
  return {
    at: '2026-11-01T00:00:00.000Z',
    articleId: 'A',
    model: '',
    text: 'I ran.',
    feedback,
    ...over,
  }
}

const filter = (over: Partial<WritingHistoryFilter> = {}): WritingHistoryFilter => ({
  source: 'all',
  scope: 'article',
  articleId: 'A',
  ...over,
})

describe('writingHistorySourceOf：来源分组', () => {
  it('旧记录 / writing 归普通仿写，production / drill 各自分组，金句课单独排除', () => {
    expect(writingHistorySourceOf(record())).toBe('writing')
    expect(writingHistorySourceOf(record({ source: 'writing' }))).toBe('writing')
    expect(writingHistorySourceOf(record({ source: 'production' }))).toBe('production')
    expect(writingHistorySourceOf(record({ source: 'drillSentence' }))).toBe('drillSentence')
    expect(writingHistorySourceOf(record({ source: 'goldenSentence' }))).toBe('writing')
  })
})

describe('filterWritingHistory：范围 + 来源 + 时间倒序', () => {
  const history = [
    record({ at: '2026-11-01T00:00:00.000Z', text: 'old' }),
    record({ at: '2026-11-04T00:00:00.000Z', source: 'drillSentence', sentenceId: 'drill:A', text: 'A drill' }),
    record({ at: '2026-11-03T00:00:00.000Z', source: 'production', text: 'A production' }),
    record({ at: '2026-11-05T00:00:00.000Z', articleId: 'B', source: 'drillSentence', text: 'B drill' }),
    record({ at: '2026-11-06T00:00:00.000Z', source: 'goldenSentence', text: 'golden' }),
  ]

  it('本篇 + 全部来源：只含本篇非金句记录，最近的在前', () => {
    expect(filterWritingHistory(history, filter()).map((r) => r.text)).toEqual([
      'A drill',
      'A production',
      'old',
    ])
  })

  it('本篇 + 拷打造句：只含本篇 drill', () => {
    expect(filterWritingHistory(history, filter({ source: 'drillSentence' })).map((r) => r.text)).toEqual([
      'A drill',
    ])
  })

  it('全库 + 拷打造句：跨篇，仍按时间倒序', () => {
    expect(
      filterWritingHistory(history, filter({ source: 'drillSentence', scope: 'all' })).map((r) => r.text),
    ).toEqual(['B drill', 'A drill'])
  })

  it('金句课记录永远不进入仿写历史筛选', () => {
    expect(filterWritingHistory(history, filter({ scope: 'all' })).some((r) => r.text === 'golden')).toBe(false)
  })
})

describe('writingHistoryCounts：当前范围的来源计数', () => {
  const history = [
    record({ source: 'writing' }),
    record({ source: 'production' }),
    record({ source: 'drillSentence' }),
    record({ articleId: 'B', source: 'drillSentence' }),
    record({ source: 'goldenExam' }),
  ]

  it('本篇：金句课不计数，来源加起来等于 all', () => {
    expect(writingHistoryCounts(history, 'article', 'A')).toEqual({
      all: 3,
      writing: 1,
      production: 1,
      drillSentence: 1,
    })
  })

  it('全库：跨篇计数', () => {
    expect(writingHistoryCounts(history, 'all', 'A')).toEqual({
      all: 4,
      writing: 1,
      production: 1,
      drillSentence: 2,
    })
  })
})

describe('removeWritingHistory：只清当前筛选，金句课保留', () => {
  const history = [
    record({ text: 'A writing', source: 'writing' }),
    record({ text: 'A drill', source: 'drillSentence' }),
    record({ text: 'A golden', source: 'goldenSentence' }),
    record({ articleId: 'B', text: 'B drill', source: 'drillSentence' }),
  ]

  it('清本篇拷打造句：不动其它来源、别的篇和金句课', () => {
    expect(
      removeWritingHistory(history, filter({ source: 'drillSentence' })).map((r) => r.text),
    ).toEqual(['A writing', 'A golden', 'B drill'])
  })

  it('清全库拷打造句：两篇 drill 都删，金句课仍在', () => {
    expect(
      removeWritingHistory(history, filter({ source: 'drillSentence', scope: 'all' })).map((r) => r.text),
    ).toEqual(['A writing', 'A golden'])
  })

  it('清全库全部来源：只保留金句课', () => {
    expect(removeWritingHistory(history, filter({ scope: 'all' })).map((r) => r.text)).toEqual(['A golden'])
  })
})
