import { describe, it, expect } from 'vitest'
import {
  mergeActivity,
  mergeAnswerEvents,
  mergeKindStats,
  mergeLibraries,
  mergeMistakes,
  mergePractice,
  mergeRetells,
  mergeSessions,
  mergeSkimmed,
  mergeStudiedDays,
  mergeStudyDays,
  mergeWritingHistory,
} from './mergeBackup'
import type { VocabItem } from '../types/document'
import type { DayActivity } from './activity'

function libItem(over: Partial<VocabItem> = {}): VocabItem {
  return {
    id: 'vocab:test',
    word: 'test',
    lemma: 'test',
    phonetic: null,
    partOfSpeech: null,
    meaning: null,
    usage: [],
    examples: [],
    source: null,
    status: 'unqueried',
    note: '',
    tags: [],
    reviewState: { ease: 2.5, due: null, interval: 0, repetitions: 0 },
    createdAt: '2026-10-01T00:00:00.000Z',
    updatedAt: '2026-10-01T00:00:00.000Z',
    ...over,
  }
}

describe('mergeLibraries', () => {
  it('按 lemma 去重互补，两边的词与字段都不丢', () => {
    const current = {
      schemaVersion: 1,
      items: [libItem({ id: 'vocab:adapt', lemma: 'adapt', word: 'adapt', meaning: '适应' })],
    }
    const incoming = {
      schemaVersion: 1,
      items: [
        libItem({ id: 'vocab:adapt2', lemma: 'adapt', word: 'adapt', definition: 'to change' }),
        libItem({ id: 'vocab:adopt', lemma: 'adopt', word: 'adopt' }),
      ],
    }
    const merged = mergeLibraries(current, incoming)
    expect(merged.items).toHaveLength(2)
    const adapt = merged.items.find((i) => i.lemma === 'adapt')!
    expect(adapt.meaning).toBe('适应') // 现有字段保留
    expect(adapt.definition).toBe('to change') // 备份补齐缺失字段
    expect(merged.items.some((i) => i.lemma === 'adopt')).toBe(true)
  })

  it('不修改入参', () => {
    const current = { schemaVersion: 1, items: [libItem({ id: 'a', lemma: 'a' })] }
    mergeLibraries(current, { schemaVersion: 1, items: [libItem({ id: 'b', lemma: 'b' })] })
    expect(current.items).toHaveLength(1)
  })
})

describe('mergeSessions', () => {
  it('去除重复记录，按时间升序', () => {
    const s = (at: string, seconds: number, picked: number) => ({ at, seconds, picked })
    const out = mergeSessions(
      [s('2026-10-02T00:00:00Z', 60, 3), s('2026-10-01T00:00:00Z', 30, 1)],
      [s('2026-10-01T00:00:00Z', 30, 1), s('2026-10-03T00:00:00Z', 10, 2)],
    )
    expect(out.map((x) => x.at)).toEqual([
      '2026-10-01T00:00:00Z',
      '2026-10-02T00:00:00Z',
      '2026-10-03T00:00:00Z',
    ])
  })
})

describe('mergeStudyDays', () => {
  it('同一天秒数与卡数相加', () => {
    const out = mergeStudyDays(
      [{ day: '2026-10-01', seconds: 60, cards: 10 }],
      [
        { day: '2026-10-01', seconds: 30, cards: 5 },
        { day: '2026-10-02', seconds: 20, cards: 2 },
      ],
    )
    expect(out).toEqual([
      { day: '2026-10-01', seconds: 90, cards: 15 },
      { day: '2026-10-02', seconds: 20, cards: 2 },
    ])
  })
})

describe('mergeActivity', () => {
  it('同一天同类相加', () => {
    const current: DayActivity[] = [{ day: '2026-10-01', counts: { read: 2 } }]
    const incoming: DayActivity[] = [
      { day: '2026-10-01', counts: { read: 3, vocab: 4 } },
      { day: '2026-10-02', counts: { listen: 1 } },
    ]
    expect(mergeActivity(current, incoming)).toEqual([
      { day: '2026-10-01', counts: { read: 5, vocab: 4 } },
      { day: '2026-10-02', counts: { listen: 1 } },
    ])
  })
})

describe('mergeWritingHistory', () => {
  it('去重后按时间倒序', () => {
    const rec = (at: string) => ({ at, articleId: 'a', model: 'm', text: 't', feedback: { scores: [], total: 0, max: 0, issues: [] } })
    const out = mergeWritingHistory([rec('2026-10-01T00:00:00Z')], [rec('2026-10-01T00:00:00Z'), rec('2026-10-02T00:00:00Z')])
    expect(out.map((r) => r.at)).toEqual(['2026-10-02T00:00:00Z', '2026-10-01T00:00:00Z'])
  })
})

describe('mergePractice', () => {
  it('按字段去重，按时间升序', () => {
    const p = (at: string, correct = 1) => ({ at, kind: 'quiz' as const, total: 2, correct })
    const out = mergePractice([p('2026-10-02T00:00:00Z')], [p('2026-10-02T00:00:00Z'), p('2026-10-01T00:00:00Z', 2)])
    expect(out.map((r) => r.at)).toEqual(['2026-10-01T00:00:00Z', '2026-10-02T00:00:00Z'])
  })
})

describe('mergeMistakes', () => {
  it('同 id 累加次数、保留更近的一条', () => {
    const old = { id: 'vocab:w', kind: 'vocab' as const, at: '2026-10-01T00:00:00Z', count: 2, label: 'w' }
    const newer = { id: 'vocab:w', kind: 'vocab' as const, at: '2026-10-02T00:00:00Z', count: 1, label: 'w' }
    const out = mergeMistakes([old], [newer])
    expect(out).toHaveLength(1)
    expect(out[0].count).toBe(3)
    expect(out[0].at).toBe('2026-10-02T00:00:00Z')
  })

  it('同一份备份再导一次不重复计数', () => {
    const m = { id: 'vocab:w', kind: 'vocab' as const, at: '2026-10-01T00:00:00Z', count: 3, label: 'w' }
    const out = mergeMistakes([m], [{ ...m }])
    expect(out[0].count).toBe(3)
  })
})

describe('mergeRetells', () => {
  it('按时间倒序去重，同一份备份再导不重复', () => {
    const r = (at: string, text = 't') => ({ at, articleId: 'a', text, words: 1 })
    const out = mergeRetells([r('2026-10-01T00:00:00Z')], [r('2026-10-01T00:00:00Z'), r('2026-10-02T00:00:00Z')])
    expect(out.map((x) => x.at)).toEqual(['2026-10-02T00:00:00Z', '2026-10-01T00:00:00Z'])
  })
})

describe('mergeStudiedDays', () => {
  it('同一天取并集，不同天各自保留', () => {
    expect(
      mergeStudiedDays(
        [{ day: '2026-10-01', ids: ['a', 'b'] }],
        [{ day: '2026-10-01', ids: ['b', 'c'] }, { day: '2026-10-02', ids: ['d'] }],
      ),
    ).toEqual([
      { day: '2026-10-01', ids: ['a', 'b', 'c'] },
      { day: '2026-10-02', ids: ['d'] },
    ])
  })
})

describe('mergeSkimmed', () => {
  it('按文章 id 取并集', () => {
    expect(mergeSkimmed(['a', 'b'], ['b', 'c'])).toEqual(['a', 'b', 'c'])
  })
})

describe('mergeAnswerEvents', () => {
  const e = (at: string, questionId?: string) => ({
    at,
    day: at.slice(0, 10),
    articleId: 'a1',
    source: 'quiz' as const,
    kind: 'cloze',
    cat: 'vocab' as const,
    correct: true,
    questionId,
  })

  it('按字段去重，重复导入不翻倍', () => {
    const current = [e('2026-01-01T00:00:00.000Z', 'q1')]
    const incoming = [e('2026-01-01T00:00:00.000Z', 'q1'), e('2026-01-02T00:00:00.000Z', 'q2')]
    expect(mergeAnswerEvents(current, incoming).map((x) => x.questionId)).toEqual(['q1', 'q2'])
  })

  it('保留最近 cap 条', () => {
    const out = mergeAnswerEvents([e('2026-01-01T00:00:00.000Z', 'q1')], [e('2026-01-02T00:00:00.000Z', 'q2')], 1)
    expect(out.map((x) => x.questionId)).toEqual(['q2'])
  })
})

describe('mergeKindStats', () => {  it('同一题型取题数更多的口径，重复导入不翻倍', () => {
    const current = { a: { cloze: { total: 5, correct: 3 } } }
    const incoming = { a: { cloze: { total: 5, correct: 3 }, spell: { total: 2, correct: 2 } } }
    const out = mergeKindStats(current, incoming)
    expect(out.a.cloze).toEqual({ total: 5, correct: 3 })
    expect(out.a.spell).toEqual({ total: 2, correct: 2 })
  })

  it('题数更多时采用新口径；不修改入参', () => {
    const current = { a: { cloze: { total: 3, correct: 1 } } }
    const incoming = { a: { cloze: { total: 5, correct: 3 } } }
    expect(mergeKindStats(current, incoming).a.cloze).toEqual({ total: 5, correct: 3 })
    expect(current.a.cloze).toEqual({ total: 3, correct: 1 })
  })
})
