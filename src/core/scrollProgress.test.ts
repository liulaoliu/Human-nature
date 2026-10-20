import { describe, expect, it } from 'vitest'
import { SCROLL_TOP, clampScrollRatio, parseScrollRatio, scrollRatioOf, scrollTopOf } from './scrollProgress'

describe('clampScrollRatio', () => {
  it('范围内的比例原样返回', () => {
    expect(clampScrollRatio(0.25)).toBe(0.25)
    expect(clampScrollRatio(1)).toBe(1)
  })

  it('越界夹到 0 / 1', () => {
    expect(clampScrollRatio(-0.5)).toBe(SCROLL_TOP)
    expect(clampScrollRatio(3)).toBe(1)
  })

  it('脏值回顶部（不返回 NaN，免得 scrollTop = NaN 把页面顶回 0 还不可控）', () => {
    expect(clampScrollRatio(Number.NaN)).toBe(SCROLL_TOP)
    expect(clampScrollRatio(Number.POSITIVE_INFINITY)).toBe(SCROLL_TOP)
    expect(clampScrollRatio('abc')).toBe(SCROLL_TOP)
    expect(clampScrollRatio(null)).toBe(SCROLL_TOP)
    expect(clampScrollRatio(undefined)).toBe(SCROLL_TOP)
  })

  it('数字字符串按数字算（localStorage 里都是字符串）', () => {
    expect(clampScrollRatio('0.5')).toBe(0.5)
  })
})

describe('parseScrollRatio', () => {
  it('没存过 → 顶部', () => {
    expect(parseScrollRatio(null)).toBe(SCROLL_TOP)
    expect(parseScrollRatio('')).toBe(SCROLL_TOP)
    expect(parseScrollRatio('   ')).toBe(SCROLL_TOP)
  })

  it('存过的合法值直接用', () => {
    expect(parseScrollRatio('0.42')).toBeCloseTo(0.42)
  })

  it('脏值 → 顶部，不炸', () => {
    expect(parseScrollRatio('abc')).toBe(SCROLL_TOP)
    expect(parseScrollRatio('{"a":1}')).toBe(SCROLL_TOP)
    expect(parseScrollRatio('-3')).toBe(SCROLL_TOP)
    expect(parseScrollRatio('9')).toBe(1)
  })
})

describe('scrollRatioOf / scrollTopOf：像素 ↔ 比例', () => {
  it('中间位置算成 0.5', () => {
    expect(scrollRatioOf(250, 500)).toBe(0.5)
  })

  it('没有可滚区间（内容不够长）→ 顶部', () => {
    expect(scrollRatioOf(120, 0)).toBe(SCROLL_TOP)
    expect(scrollTopOf(0.8, 0)).toBe(0)
  })

  it('滚过头（惯性 / 缩放）夹到 1', () => {
    expect(scrollRatioOf(900, 500)).toBe(1)
  })

  it('比例还原成像素', () => {
    expect(scrollTopOf(0.5, 500)).toBe(250)
    expect(scrollTopOf(1, 500)).toBe(500)
  })

  it('脏值当顶部', () => {
    expect(scrollRatioOf(Number.NaN, 500)).toBe(SCROLL_TOP)
    expect(scrollTopOf(Number.NaN, 500)).toBe(0)
  })
})
