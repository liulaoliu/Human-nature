import { describe, it, expect } from 'vitest'
import { buildJournalDay, journalDays, type JournalInput } from './journal'
import type { VocabItem } from '../types/document'

const item = (id: string, createdAt: string): VocabItem => ({
  id,
  word: id,
  lemma: id,
  phonetic: null,
  partOfSpeech: 'n.',
  meaning: 'x',
  usage: [],
  examples: [],
  source: null,
  status: 'queried',
  note: '',
  tags: [],
  reviewState: { ease: 2.5, due: null, interval: 0, repetitions: 0 },
  createdAt,
  updatedAt: createdAt,
})

const input = (over: Partial<JournalInput> = {}): JournalInput => ({
  studied: [],
  items: [],
  articles: [],
  activity: [],
  practice: [],
  ...over,
})

describe('journalDays / buildJournalDay', () => {
  it('汇总各类记录里的日期，倒序去重', () => {
    const days = journalDays(
      input({
        studied: [{ day: '2026-10-15', ids: ['a'] }],
        items: [item('b', '2026-10-14T09:00:00.000Z')],
        activity: [{ day: '2026-10-13', counts: { vocab: 3 } }],
        practice: [{ at: '2026-10-15T10:00:00.000Z', kind: 'quiz', total: 5, correct: 4 }],
      }),
    )
    expect(days).toEqual(['2026-10-15', '2026-10-14', '2026-10-13'])
  })

  it('某天明细：背过的词 / 新增的词 / 新增语言点 / 活动 / 成绩', () => {
    const day = '2026-10-15'
    const j = buildJournalDay(
      input({
        studied: [{ day, ids: ['a', 'b', 'a'] }],
        items: [item('a', '2026-10-10T00:00:00.000Z'), item('b', `${day}T08:00:00.000Z`), item('c', '2026-10-01T00:00:00.000Z')],
        activity: [{ day, counts: { vocab: 2, read: 5 } }],
        practice: [
          { at: `${day}T10:00:00.000Z`, kind: 'quiz', total: 4, correct: 3 },
          { at: `${day}T11:00:00.000Z`, kind: 'quiz', total: 2, correct: 2 },
        ],
        articles: [
          {
            id: 'art1',
            title: 'T',
            sentences: [
              { id: 's1', text: 'Hello.', languages: [{ grammar: 'x', source: 'ai', at: `${day}T09:00:00.000Z` }] },
              { id: 's2', text: 'Bye.', languages: [{ phrases: ['a b'], source: 'manual', at: '2026-10-14T09:00:00.000Z' }] },
            ],
          },
        ],
      }),
      day,
    )
    expect(j.studied.map((x) => x.id)).toEqual(['a', 'b']) // 去重、按记录顺序
    expect(j.addedWords.map((x) => x.id)).toEqual(['b']) // 只有 b 是当天新增
    expect(j.addedLanguages).toHaveLength(1)
    expect(j.addedLanguages[0]).toMatchObject({ sentenceId: 's1', manual: false, grammar: 'x' })
    expect(j.activity).toEqual({ vocab: 2, read: 5 })
    expect(j.practice).toEqual([{ kind: 'quiz', total: 6, correct: 5 }])
  })

  it('没有记录的日期 → 空明细（不炸）', () => {
    const j = buildJournalDay(input(), '2026-01-01')
    expect(j.studied).toEqual([])
    expect(j.addedWords).toEqual([])
    expect(j.addedLanguages).toEqual([])
    expect(j.practice).toEqual([])
  })
})
