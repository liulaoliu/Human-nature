import { describe, expect, it } from 'vitest'
import {
  FISH_POS_DEFAULT,
  FISH_SIZE_DEFAULT,
  FISH_SIZE_HALF,
  FISH_SIZE_MAX,
  FISH_SIZE_MIN,
  clampFishPos,
  clampFishSize,
  nextFishSize,
  parseFishPos,
  parseFishSize,
} from './fishLayout'

describe('clampFishSize', () => {
  it('范围外的数夹到边界', () => {
    expect(clampFishSize(10)).toBe(FISH_SIZE_MIN)
    expect(clampFishSize(9999)).toBe(FISH_SIZE_MAX)
  })

  it('范围内的数取整保留', () => {
    expect(clampFishSize(120.6)).toBe(121)
  })

  it('NaN / Infinity 回默认值', () => {
    expect(clampFishSize(Number.NaN)).toBe(FISH_SIZE_DEFAULT)
    expect(clampFishSize(Number.POSITIVE_INFINITY)).toBe(FISH_SIZE_DEFAULT)
  })
})

describe('nextFishSize：双击循环', () => {
  it('最小 → 50% → 最大 → 最小', () => {
    expect(nextFishSize(FISH_SIZE_MIN)).toBe(FISH_SIZE_HALF)
    expect(nextFishSize(FISH_SIZE_HALF)).toBe(FISH_SIZE_MAX)
    expect(nextFishSize(FISH_SIZE_MAX)).toBe(FISH_SIZE_MIN)
  })

  it('默认尺寸是最大尺寸的 20%，不在三档上：第一下双击回最小', () => {
    expect(FISH_SIZE_DEFAULT).toBe(76)
    expect(nextFishSize(FISH_SIZE_DEFAULT)).toBe(FISH_SIZE_MIN)
  })

  it('滚轮 / 拖拽停在档与档之间时先回最小', () => {
    expect(nextFishSize(123)).toBe(FISH_SIZE_MIN)
  })

  it('脏值按默认尺寸处理，第一下同样先回最小', () => {
    expect(nextFishSize(Number.NaN)).toBe(FISH_SIZE_MIN)
  })

  it('50% = 最大值的一半', () => {
    expect(FISH_SIZE_HALF).toBe(190)
  })
})

describe('clampFishPos', () => {
  it('正常位置原样返回', () => {
    expect(clampFishPos(100, 60, 104, { w: 1200, h: 800 })).toEqual({ right: 100, bottom: 60 })
  })

  it('负数回 0（不许飘出左上角）', () => {
    expect(clampFishPos(-30, -5, 104, { w: 1200, h: 800 })).toEqual({ right: 0, bottom: 0 })
  })

  it('窗口变小时夹到右下边界', () => {
    // 104px 的鱼放在 200x150 的窗口里：最多 right 96 / bottom 46
    expect(clampFishPos(800, 600, 104, { w: 200, h: 150 })).toEqual({ right: 96, bottom: 46 })
  })

  it('窗口比鱼还小时两边都退到 0', () => {
    expect(clampFishPos(50, 50, 300, { w: 100, h: 100 })).toEqual({ right: 0, bottom: 0 })
  })
})

describe('parseFishSize', () => {
  it('没存过 → 默认值', () => {
    expect(parseFishSize(null)).toBe(FISH_SIZE_DEFAULT)
    expect(parseFishSize('')).toBe(FISH_SIZE_DEFAULT)
  })

  it('存过的合法值直接用', () => {
    expect(parseFishSize('160')).toBe(160)
  })

  it('脏值 / 越界 → 默认值', () => {
    expect(parseFishSize('abc')).toBe(FISH_SIZE_DEFAULT)
    expect(parseFishSize('5')).toBe(FISH_SIZE_DEFAULT)
    expect(parseFishSize('9999')).toBe(FISH_SIZE_DEFAULT)
  })
})

describe('parseFishPos', () => {
  it('没存过 → 默认位置', () => {
    expect(parseFishPos(null)).toEqual(FISH_POS_DEFAULT)
  })

  it('合法 JSON 读回来（取整）', () => {
    expect(parseFishPos('{"right":100.4,"bottom":20.6}')).toEqual({ right: 100, bottom: 21 })
  })

  it('坏 JSON / 缺字段 / 非数字 → 默认位置', () => {
    expect(parseFishPos('{oops')).toEqual(FISH_POS_DEFAULT)
    expect(parseFishPos('{"right":10}')).toEqual(FISH_POS_DEFAULT)
    expect(parseFishPos('{"right":"10","bottom":"20"}')).toEqual(FISH_POS_DEFAULT)
    expect(parseFishPos('null')).toEqual(FISH_POS_DEFAULT)
  })
})
