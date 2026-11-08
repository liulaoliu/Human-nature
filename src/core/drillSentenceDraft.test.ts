import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { installFakeStorage } from '../reader/testStorage'
import {
  DRILL_DRAFT_CAP,
  DRILL_SENTENCE_DRAFT_KEY,
  hasDrillSentenceDraft,
  loadDrillSentenceDraft,
  normalizeDrillSentenceDraft,
  normalizeDrillSentenceDraftMap,
  readDrillSentenceDrafts,
  removeDrillSentenceDraft,
  saveDrillSentenceDraft,
  type DrillSentenceDraft,
} from './drillSentenceDraft'

let restore: () => void = () => {}

beforeEach(() => {
  restore = installFakeStorage()
  localStorage.clear()
})
afterEach(() => {
  restore()
})

function draft(over: Partial<DrillSentenceDraft> = {}): DrillSentenceDraft {
  return {
    batchId: 'batch-1',
    activeIndex: 2,
    answers: {
      'drill:memory:v1:run': { answer: 'I run daily.', round: 1, at: '2026-11-08T03:00:00.000Z' },
    },
    at: '2026-11-08T03:00:00.000Z',
    ...over,
  }
}

describe('拷打造句草稿', () => {
  it('存一轮再读回来：停在第几题、每题的作答都在', () => {
    saveDrillSentenceDraft(draft())
    const back = loadDrillSentenceDraft('batch-1')
    expect(back?.activeIndex).toBe(2)
    expect(back?.answers['drill:memory:v1:run']?.answer).toBe('I run daily.')
    expect(hasDrillSentenceDraft('batch-1')).toBe(true)
    expect(loadDrillSentenceDraft('batch-2')).toBeNull()
  })

  it('换一批题各存各的，删一轮不影响别的', () => {
    saveDrillSentenceDraft(draft())
    saveDrillSentenceDraft(
      draft({ batchId: 'batch-2', activeIndex: 0, at: '2026-11-08T04:00:00.000Z' }),
    )
    expect(Object.keys(readDrillSentenceDrafts()).sort()).toEqual(['batch-1', 'batch-2'])
    removeDrillSentenceDraft('batch-1')
    expect(loadDrillSentenceDraft('batch-1')).toBeNull()
    expect(loadDrillSentenceDraft('batch-2')?.activeIndex).toBe(0)
  })

  it(`只留最近 ${DRILL_DRAFT_CAP} 轮，更早的按时间倒序裁掉`, () => {
    for (let i = 0; i < DRILL_DRAFT_CAP + 2; i++) {
      saveDrillSentenceDraft(draft({ batchId: `b${i}`, at: `2026-11-08T0${i}:00:00.000Z` }))
    }
    const map = readDrillSentenceDrafts()
    expect(Object.keys(map)).toHaveLength(DRILL_DRAFT_CAP)
    expect(map['b0']).toBeUndefined()
    expect(map['b1']).toBeUndefined()
    expect(map[`b${DRILL_DRAFT_CAP + 1}`]).toBeTruthy()
  })

  it('坏数据当没有：不是对象 / 没 batchId / JSON 坏掉', () => {
    expect(normalizeDrillSentenceDraft(null)).toBeNull()
    expect(normalizeDrillSentenceDraft('x')).toBeNull()
    expect(normalizeDrillSentenceDraft({ activeIndex: 1 })).toBeNull()
    localStorage.setItem(DRILL_SENTENCE_DRAFT_KEY, '{"batch-1": {坏 json')
    expect(readDrillSentenceDrafts()).toEqual({})
    expect(loadDrillSentenceDraft('batch-1')).toBeNull()
  })

  it('空作答、非字符串作答都丢掉，坏的题号收回到第一题', () => {
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

  it('删掉最后一轮时把键清干净', () => {
    saveDrillSentenceDraft(draft())
    removeDrillSentenceDraft('batch-1')
    expect(localStorage.getItem(DRILL_SENTENCE_DRAFT_KEY)).toBeNull()
  })
})
