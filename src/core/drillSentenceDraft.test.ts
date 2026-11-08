import { describe, expect, it } from 'vitest'
import {
  DRILL_DRAFT_CAP,
  normalizeDrillSentenceDraft,
  normalizeDrillSentenceDraftMap,
  trimDrillSentenceDrafts,
  type DrillSentenceDraft,
} from './drillSentenceDraft'

function draft(over: Partial<DrillSentenceDraft> = {}): DrillSentenceDraft {
  return {
    batchId: 'b',
    activeIndex: 0,
    answers: {},
    at: '2026-11-08T03:00:00.000Z',
    ...over,
  }
}

describe('拷打造句草稿的校验规则', () => {
  it('不是对象 / 没 batchId 都当没有', () => {
    expect(normalizeDrillSentenceDraft(null)).toBeNull()
    expect(normalizeDrillSentenceDraft('x')).toBeNull()
    expect(normalizeDrillSentenceDraft([1])).toBeNull()
    expect(normalizeDrillSentenceDraft({ activeIndex: 1 })).toBeNull()
    expect(normalizeDrillSentenceDraft({ batchId: '' })).toBeNull()
  })

  it('空作答 / 非字符串作答都丢掉，坏的题号收回到第一题', () => {
    const back = normalizeDrillSentenceDraftMap({
      'batch-1': {
        batchId: 'batch-1',
        activeIndex: -5,
        at: 'x',
        answers: {
          ok: { answer: 'fine', round: 2, at: 't' },
          blank: { answer: '   ' },
          num: { answer: 3 },
          raw: 'text',
        },
      },
    })
    expect(back['batch-1']?.activeIndex).toBe(0)
    expect(Object.keys(back['batch-1']?.answers ?? {})).toEqual(['ok'])
    expect(back['batch-1']?.answers['ok']?.round).toBe(2)
  })

  it('题号是有限数就取整并夹到 0 以上；缺字段给默认值', () => {
    const back = normalizeDrillSentenceDraft({ batchId: 'b', activeIndex: 2.7 })
    expect(back?.activeIndex).toBe(2)
    expect(back?.at).toBe('')
    expect(normalizeDrillSentenceDraft({ batchId: 'b', activeIndex: Number.NaN })?.activeIndex).toBe(0)
  })

  it(`裁剪只留最近 ${DRILL_DRAFT_CAP} 轮，按时间倒序`, () => {
    const map: Record<string, DrillSentenceDraft> = {}
    for (let i = 0; i < DRILL_DRAFT_CAP + 3; i++) {
      const id = `b${i}`
      map[id] = draft({ batchId: id, at: `2026-11-08T${String(i).padStart(2, '0')}:00:00.000Z` })
    }
    const trimmed = trimDrillSentenceDrafts(map)
    expect(Object.keys(trimmed)).toHaveLength(DRILL_DRAFT_CAP)
    expect(trimmed['b0']).toBeUndefined()
    expect(trimmed[`b${DRILL_DRAFT_CAP + 2}`]).toBeTruthy()
  })

  it('裁剪可以被显式放宽（上限当参数传）', () => {
    const map = { a: draft({ batchId: 'a' }), b: draft({ batchId: 'b', at: '2026-11-09T00:00:00.000Z' }) }
    expect(Object.keys(trimDrillSentenceDrafts(map, 1))).toEqual(['b'])
  })
})
