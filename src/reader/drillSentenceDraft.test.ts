import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { installFakeStorage } from './testStorage'
import {
  DRILL_DRAFT_CAP,
  DRILL_SENTENCE_DRAFT_KEY,
  hasDrillSentenceDraft,
  loadDrillSentenceDraft,
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
      // 两位数补零：i ≥ 10 时 `0${i}` 会拼出非法时间，排序断言会假失败
      const hh = String(i).padStart(2, '0')
      saveDrillSentenceDraft(draft({ batchId: `b${i}`, at: `2026-11-08T${hh}:00:00.000Z` }))
    }
    const map = readDrillSentenceDrafts()
    expect(Object.keys(map)).toHaveLength(DRILL_DRAFT_CAP)
    expect(map['b0']).toBeUndefined()
    expect(map['b1']).toBeUndefined()
    expect(map[`b${DRILL_DRAFT_CAP + 1}`]).toBeTruthy()
  })

  it('坏数据当没有：JSON 坏掉 / 整份不是对象', () => {
    localStorage.setItem(DRILL_SENTENCE_DRAFT_KEY, '{"batch-1": {坏 json')
    expect(readDrillSentenceDrafts()).toEqual({})
    expect(loadDrillSentenceDraft('batch-1')).toBeNull()
    localStorage.setItem(DRILL_SENTENCE_DRAFT_KEY, '["batch-1"]')
    expect(readDrillSentenceDrafts()).toEqual({})
  })

  it('形状不对的条目跳过，好的照留（校验规则在 core）', () => {
    localStorage.setItem(
      DRILL_SENTENCE_DRAFT_KEY,
      JSON.stringify({
        'batch-1': { batchId: 'batch-1', activeIndex: 1, at: 'x', answers: {} },
        'batch-2': { activeIndex: 0 },
        'batch-3': 'nope',
      }),
    )
    expect(Object.keys(readDrillSentenceDrafts())).toEqual(['batch-1'])
  })

  it('删掉最后一轮时把键清干净', () => {
    saveDrillSentenceDraft(draft())
    removeDrillSentenceDraft('batch-1')
    expect(localStorage.getItem(DRILL_SENTENCE_DRAFT_KEY)).toBeNull()
  })

  it('别人改了盘上的数据（另一个标签页 / 备份导入 / 被清空），读的时候要看见新值', () => {
    saveDrillSentenceDraft(draft())
    expect(loadDrillSentenceDraft('batch-1')?.activeIndex).toBe(2)

    // 外部整份改写：缓存不能一直喂旧值
    localStorage.setItem(
      DRILL_SENTENCE_DRAFT_KEY,
      JSON.stringify({
        'batch-1': { batchId: 'batch-1', activeIndex: 0, at: '2026-11-08T05:00:00.000Z', answers: {} },
      }),
    )
    expect(loadDrillSentenceDraft('batch-1')?.activeIndex).toBe(0)

    // 外部直接清空：读回来当没有
    localStorage.removeItem(DRILL_SENTENCE_DRAFT_KEY)
    expect(readDrillSentenceDrafts()).toEqual({})
    expect(loadDrillSentenceDraft('batch-1')).toBeNull()
  })
})
