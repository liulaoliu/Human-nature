import { describe, it, expect } from 'vitest'
import { joinAnchorAt, nudgeAnchorEdge, splitAnchorSpan } from './anchorEdits'
import type { Chunk, ManualAnchor } from './ports'

const WORDS = ['one', 'two', 'three', 'four', 'five', 'six']

const span = (atSec: number, startWord: number, endWord: number): ManualAnchor => ({
  atSec,
  startWord,
  endWord,
  text: WORDS.slice(startWord, endWord).join(' '),
})

const CHUNK: Chunk = { index: 0, start: 2, end: 6 }

describe('splitAnchorSpan', () => {
  it('按刀口比例拆成两半，词不丢不重', () => {
    const out = splitAnchorSpan(CHUNK, span(2, 0, 4), WORDS, 4)
    expect(out).not.toBeNull()
    const [a, b] = out!
    expect(a.atSec).toBe(2) // 前半留在原块起点
    expect(b.atSec).toBe(4) // 后半挂到刀口
    expect(a.startWord).toBe(0)
    expect(b.endWord).toBe(4)
    expect(a.endWord).toBe(b.startWord) // 首尾相接
  })

  it('刀口贴着块首时，前半至少留一个词', () => {
    const [a, b] = splitAnchorSpan(CHUNK, span(2, 0, 4), WORDS, 2)!
    expect(a.endWord).toBe(1)
    expect(b.startWord).toBe(1)
  })

  it('刀口贴着块尾时，后半至少留一个词', () => {
    const [a, b] = splitAnchorSpan(CHUNK, span(2, 0, 4), WORDS, 6)!
    expect(a.endWord).toBe(3)
    expect(b.endWord).toBe(4)
  })

  it('拆出来的两半文字重新拼得回原文', () => {
    const [a, b] = splitAnchorSpan(CHUNK, span(2, 0, 4), WORDS, 3)!
    expect(`${a.text} ${b.text}`).toBe("one two three four")
  })

  it('只有 1 个词的锚点不拆（拆了必有一半是空的）', () => {
    expect(splitAnchorSpan(CHUNK, span(2, 1, 2), WORDS, 4)).toBeNull()
  })
})

describe('joinAnchorAt', () => {
  it('边界上的锚点并进前一个，终点取两者最大', () => {
    const out = joinAnchorAt([span(2, 0, 2), span(4, 2, 5)], 4, WORDS)!
    expect(out).toHaveLength(1)
    expect(out[0]).toMatchObject({ atSec: 2, startWord: 0, endWord: 5 })
    expect(out[0].text).toBe('one two three four five')
  })

  it('边界上没有锚点时返回 null（调用方不用改）', () => {
    expect(joinAnchorAt([span(2, 0, 2)], 4, WORDS)).toBeNull()
  })

  it('边界上是第一个锚点（前面没有）时直接去掉它', () => {
    const out = joinAnchorAt([span(2, 0, 2), span(4, 2, 4)], 2, WORDS)!
    expect(out.map((a) => a.atSec)).toEqual([4])
  })

  it('不相邻的锚点不被动到', () => {
    const out = joinAnchorAt([span(2, 0, 1), span(4, 1, 3), span(6, 3, 5)], 4, WORDS)!
    expect(out.map((a) => a.atSec)).toEqual([2, 6])
  })
})

describe('nudgeAnchorEdge', () => {
  const s = { startWord: 2, endWord: 4 }

  it('起点往前挪，夹住前一个锚点的终点', () => {
    expect(nudgeAnchorEdge(s, 'start', -5, 1, 6)).toEqual({ startWord: 1, endWord: 4 })
  })

  it('起点往后挪，但至少留一个词', () => {
    expect(nudgeAnchorEdge(s, 'start', 9, 0, 6)).toEqual({ startWord: 3, endWord: 4 })
  })

  it('终点往后挪，夹住后一个锚点的起点', () => {
    expect(nudgeAnchorEdge(s, 'end', 9, 0, 5)).toEqual({ startWord: 2, endWord: 5 })
  })

  it('终点往前挪，但至少留一个词', () => {
    expect(nudgeAnchorEdge(s, 'end', -9, 0, 6)).toEqual({ startWord: 2, endWord: 3 })
  })

  it('没有前后邻居时按 0 / 总词数兜底', () => {
    expect(nudgeAnchorEdge({ startWord: 0, endWord: 6 }, 'start', -3, 0, 6)).toEqual({
      startWord: 0,
      endWord: 6,
    })
    expect(nudgeAnchorEdge({ startWord: 0, endWord: 6 }, 'end', 3, 0, 6)).toEqual({
      startWord: 0,
      endWord: 6,
    })
  })
})
