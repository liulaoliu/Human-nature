import { describe, expect, it } from 'vitest'
import { dayDetail, fmtSpan, summarizeRange, type StatsInput } from './statsSummary'

/**
 * 统计汇总口径：区间判定、六类记录各自怎么算、坏数据怎么丢。
 * 面板只负责把这些数字画出来，规则全在这里。
 */

function input(over: Partial<StatsInput> = {}): StatsInput {
  return {
    studyDays: [],
    writingHistory: [],
    retells: [],
    readDone: [],
    goldenDrills: [],
    practice: [],
    ...over,
  }
}

/** 某天中午的 ISO（避免时区把日期挤到前一天）。 */
function at(day: string, hh = 12): string {
  return `${day}T${String(hh).padStart(2, '0')}:00:00`
}

describe('summarizeRange', () => {
  it('没有任何记录时全为 0', () => {
    const s = summarizeRange(input(), '2026-10-01', '2026-10-31')
    expect(s).toEqual({
      study: { cards: 0, seconds: 0 },
      writing: { count: 0, words: 0 },
      retell: { count: 0, words: 0 },
      readDone: 0,
      golden: 0,
      practice: { total: 0, correct: 0 },
    })
  })

  it('区间是闭区间：首尾两天都算进来，界外不算', () => {
    const s = summarizeRange(
      input({
        readDone: [
          { day: '2026-09-30', articleId: 'a', title: 'a', at: at('2026-09-30') },
          { day: '2026-10-01', articleId: 'b', title: 'b', at: at('2026-10-01') },
          { day: '2026-10-31', articleId: 'c', title: 'c', at: at('2026-10-31') },
          { day: '2026-11-01', articleId: 'd', title: 'd', at: at('2026-11-01') },
        ],
      }),
      '2026-10-01',
      '2026-10-31',
    )
    expect(s.readDone).toBe(2)
  })

  it('from > to 或空区间返回全 0（不反向遍历出负数）', () => {
    const s = summarizeRange(input({ studyDays: [{ day: '2026-10-05', cards: 9, seconds: 90 }] }), '2026-10-31', '2026-10-01')
    expect(s.study).toEqual({ cards: 0, seconds: 0 })
    expect(summarizeRange(input(), '', '2026-10-31').study.cards).toBe(0)
  })

  it('背单词按天累加张数与秒数', () => {
    const s = summarizeRange(
      input({
        studyDays: [
          { day: '2026-10-02', cards: 20, seconds: 300 },
          { day: '2026-10-03', cards: 5, seconds: 60 },
          { day: '2026-09-01', cards: 99, seconds: 999 },
        ],
      }),
      '2026-10-01',
      '2026-10-31',
    )
    expect(s.study).toEqual({ cards: 25, seconds: 360 })
  })

  it('写作按 ISO 时刻换逻辑日，字数与速读同一口径', () => {
    const rec = (day: string, text: string) =>
      ({ at: at(day), articleId: 'a', model: '', text, feedback: {} as never }) as never
    const s = summarizeRange(
      input({
        writingHistory: [
          rec('2026-10-02', 'one two three'),
          rec('2026-10-03', '  four   five '),
          rec('2026-09-20', 'outside range'),
        ],
      }),
      '2026-10-01',
      '2026-10-31',
    )
    expect(s.writing).toEqual({ count: 2, words: 5 })
  })

  it('复述用打卡时算好的字数；老数据缺字数才现算', () => {
    const s = summarizeRange(
      input({
        retells: [
          { at: at('2026-10-02'), articleId: 'a', text: 'ignored words here', words: 7 },
          { at: at('2026-10-03'), articleId: 'a', text: 'a b c', words: Number.NaN },
        ],
      }),
      '2026-10-01',
      '2026-10-31',
    )
    expect(s.retell).toEqual({ count: 2, words: 10 })
  })

  it('金句只数已掌握的，日期优先 completedAt、缺了退回 at', () => {
    const drill = (over: Record<string, unknown>) =>
      ({ id: 'x', articleId: 'a', sentenceId: 's', drillKey: 'k', at: at('2026-10-01'), ...over }) as never
    const s = summarizeRange(
      input({
        goldenDrills: [
          drill({ mastered: true, completedAt: at('2026-10-05') }),
          drill({ mastered: true, at: at('2026-10-06') }),
          drill({ mastered: false, at: at('2026-10-07') }),
          drill({ mastered: true, completedAt: at('2026-09-01') }),
        ],
      }),
      '2026-10-01',
      '2026-10-31',
    )
    expect(s.golden).toBe(2)
  })

  it('练习累加题数与答对数（含金句课，不在这里筛题型）', () => {
    const s = summarizeRange(
      input({
        practice: [
          { at: at('2026-10-02'), kind: 'quiz', total: 4, correct: 3 },
          { at: at('2026-10-03'), kind: 'golden', total: 2, correct: 2 },
        ],
      }),
      '2026-10-01',
      '2026-10-31',
    )
    expect(s.practice).toEqual({ total: 6, correct: 5 })
  })

  it('坏日期 / 缺字段不会算进任何一天', () => {
    const s = summarizeRange(
      input({
        writingHistory: [{ at: 'not-a-date', articleId: 'a', model: '', text: 'x y', feedback: {} as never } as never],
        practice: [{ at: '', kind: 'quiz', total: 5, correct: 5 }],
        studyDays: [{ day: '', cards: 3, seconds: 30 }],
      }),
      '2026-10-01',
      '2026-10-31',
    )
    expect(s.writing.count).toBe(0)
    expect(s.practice.total).toBe(0)
    expect(s.study.cards).toBe(0)
  })
})

describe('dayDetail', () => {
  const base = input({
    studyDays: [{ day: '2026-10-05', cards: 12, seconds: 240 }],
    readDone: [
      { day: '2026-10-05', articleId: 'a', title: 'a', at: at('2026-10-05') },
      { day: '2026-10-06', articleId: 'b', title: 'b', at: at('2026-10-06') },
    ],
  })

  it('单日汇总 = 同一套区间判定（from = to = day）', () => {
    const d = dayDetail(base, [], '2026-10-05')
    expect(d.day).toBe('2026-10-05')
    expect(d.study).toEqual({ cards: 12, seconds: 240 })
    expect(d.readDone).toBe(1)
  })

  it('五类活动量走 core/activity.sumCats，不另算一份', () => {
    const d = dayDetail(
      base,
      [
        { day: '2026-10-05', counts: { read: 2, vocab: 7 } },
        { day: '2026-10-06', counts: { read: 99 } },
      ],
      '2026-10-05',
    )
    expect(d.cats).toEqual({ read: 2, vocab: 7, listen: 0, write: 0, speak: 0 })
  })

  it('没有活动记录的那天也返回全 0 结构（面板不用判空）', () => {
    const d = dayDetail(input(), [], '2026-10-05')
    expect(d.cats).toEqual({ read: 0, vocab: 0, listen: 0, write: 0, speak: 0 })
    expect(d.practice).toEqual({ total: 0, correct: 0 })
  })
})

describe('fmtSpan', () => {
  it('按秒 / 分钟 / 小时分档', () => {
    expect(fmtSpan(0)).toBe('0 秒')
    expect(fmtSpan(48)).toBe('48 秒')
    expect(fmtSpan(60)).toBe('1 分钟')
    expect(fmtSpan(3540)).toBe('59 分钟')
    expect(fmtSpan(3600)).toBe('1 小时')
    expect(fmtSpan(4320)).toBe('1 小时 12 分')
  })

  it('负数与脏数据当 0，不抛错', () => {
    expect(fmtSpan(-5)).toBe('0 秒')
    expect(fmtSpan(Number.NaN)).toBe('0 秒')
  })
})
