import { describe, it, expect } from 'vitest'
import { itemsToText, parsePageRange } from './importers'

describe('parsePageRange', () => {
  it('空 = 全部页', () => {
    expect(parsePageRange('', 3)).toEqual([1, 2, 3])
    expect(parsePageRange(undefined, 2)).toEqual([1, 2])
  })
  it('区间与单页混用，去重排序', () => {
    expect(parsePageRange('2-4,6,3', 8)).toEqual([2, 3, 4, 6])
  })
  it('越界被夹住', () => {
    expect(parsePageRange('0-99', 3)).toEqual([1, 2, 3])
  })
})

describe('itemsToText', () => {
  it('hasEOL 断行，纵向大间距当段落', () => {
    const items = [
      { str: 'Hello', transform: [0, 0, 0, 0, 0, 100], height: 10, hasEOL: false },
      { str: ' world', transform: [0, 0, 0, 0, 0, 100], height: 10, hasEOL: true },
      { str: 'Second para', transform: [0, 0, 0, 0, 0, 80], height: 10, hasEOL: true },
    ]
    expect(itemsToText(items)).toBe('Hello world\n\nSecond para')
  })
  it('忽略没有 str 的项', () => {
    expect(itemsToText([{ transform: [0, 0, 0, 0, 0, 0] }, { str: 'ok', hasEOL: true }])).toBe('ok')
  })
})
