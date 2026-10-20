import { describe, expect, it } from 'vitest'
import { alignTimings } from './ttsTiming'

describe('alignTimings：TTS 逐词时间对齐', () => {
  it('同序对齐；大小写与标点归一化后比较', () => {
    const out = alignTimings('Hello, WORLD!', [
      { part: 'hello', start: 0, end: 100 },
      { part: 'world', start: 100, end: 240 },
    ])
    expect(out).toEqual([
      { start: 0, end: 100 },
      { start: 100, end: 240 },
    ])
  })

  it('时间戳缺一个词：用同位置兜底，避免整体错位', () => {
    const out = alignTimings('one two three', [
      { part: 'one', start: 0, end: 10 },
      { part: 'three', start: 20, end: 30 },
    ])
    // 第二个词没返回：拿同位置的 third 时间兜底；第三个词已无时间戳 → 0（不高亮）
    expect(out[0]).toEqual({ start: 0, end: 10 })
    expect(out[1]).toEqual({ start: 20, end: 30 })
    expect(out[2]).toEqual({ start: 0, end: 0 })
  })

  it('时间戳多于词数：多余的忽略；完全没时间戳：全 0', () => {
    const extra = alignTimings('one', [
      { part: 'one', start: 0, end: 10 },
      { part: 'two', start: 10, end: 20 },
    ])
    expect(extra).toEqual([{ start: 0, end: 10 }])

    expect(alignTimings('one two', [])).toEqual([
      { start: 0, end: 0 },
      { start: 0, end: 0 },
    ])
  })

  it('空句子 → 空数组', () => {
    expect(alignTimings('   ', [{ part: 'x', start: 0, end: 1 }])).toEqual([])
  })
})
