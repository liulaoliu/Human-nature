import { describe, it, expect } from 'vitest'
import { caretWordIndex, wordRangeFromText } from './pickWords'

const TEXT = 'aa bb cc dd '

describe('caretWordIndex', () => {
  it('空串是 0', () => {
    expect(caretWordIndex('')).toBe(0)
  })

  it('落在词里/词尾 = 这个词的下标', () => {
    expect(caretWordIndex('aa')).toBe(0)
    expect(caretWordIndex('aa bb')).toBe(1)
    expect(caretWordIndex('aa bb cc')).toBe(2)
  })

  it('以空格结尾 = 已经跨过前一个词', () => {
    expect(caretWordIndex('aa ')).toBe(1)
    expect(caretWordIndex('aa bb ')).toBe(2)
    expect(caretWordIndex('   ')).toBe(0)
  })
})

describe('wordRangeFromText', () => {
  it('选完整的两个词（终点在空格后）', () => {
    // "aa bb" 的下标是 [0,5)，到空格 [0,6)
    expect(wordRangeFromText(TEXT, 0, 5)).toEqual([0, 2])
    expect(wordRangeFromText(TEXT, 0, 6)).toEqual([0, 2])
  })

  it('终点落在词中间时把那个词算进来', () => {
    expect(wordRangeFromText(TEXT, 0, 4)).toEqual([0, 2]) // "aa b"
  })

  it('起点落在词中间时从那个词开始', () => {
    expect(wordRangeFromText(TEXT, 1, 6)).toEqual([0, 2]) // "a" 起到 "bb"
  })

  it('起点在空格后 = 从下一个词开始', () => {
    expect(wordRangeFromText(TEXT, 3, 6)).toEqual([1, 2]) // "bb"
  })

  it('取中间两个词', () => {
    expect(wordRangeFromText(TEXT, 3, 9)).toEqual([1, 3]) // "bb cc"
  })

  it('一直选到末尾', () => {
    expect(wordRangeFromText(TEXT, 3, TEXT.length)).toEqual([1, 4])
  })

  it('下标越界会夹住，不报错', () => {
    expect(wordRangeFromText(TEXT, -10, 999)).toEqual([0, 4])
  })

  it('端点顺序反了也能纠正', () => {
    expect(wordRangeFromText(TEXT, 6, 0)).toEqual([0, 2])
  })

  it('光标 / 空选区返回 null', () => {
    expect(wordRangeFromText(TEXT, 3, 3)).toBeNull()
    expect(wordRangeFromText(TEXT, 0, 0)).toBeNull()
  })

  it('只选到一段空白也算不出词', () => {
    // "   " 这种没有词的区间
    expect(wordRangeFromText('   ', 0, 3)).toBeNull()
  })

  it('结果始终单调且落在词数内', () => {
    const total = TEXT.trim().split(/\s+/).length
    for (let a = 0; a <= TEXT.length; a++) {
      for (let b = a; b <= TEXT.length; b++) {
        const r = wordRangeFromText(TEXT, a, b)
        if (!r) continue
        expect(r[0]).toBeLessThan(r[1])
        expect(r[0]).toBeGreaterThanOrEqual(0)
        expect(r[1]).toBeLessThanOrEqual(total)
      }
    }
  })
})
