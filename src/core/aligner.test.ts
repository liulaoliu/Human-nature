import { describe, it, expect } from 'vitest'
import { alignSentences } from './aligner'
import { defaultReviewState } from '../types/document'
import type { Chunk } from './ports'
import type { Sentence } from '../types/document'

function s(id: string, text: string): Sentence {
  return {
    id,
    paraId: 'p01',
    text,
    audio: null,
    translation: null,
    grammarNote: null,
    collocations: [],
    vocab: [],
    tags: [],
    reviewState: defaultReviewState(),
  }
}

const chunks: Chunk[] = [
  { index: 0, start: 0, end: 10 },
  { index: 1, start: 10, end: 20 },
]

describe('alignSentences', () => {
  it('按比例把句子的词投影到块时间', () => {
    const out = alignSentences([s('s001', 'alpha beta'), s('s002', 'gamma delta')], chunks)
    expect(out[0].audio).toEqual({ start: 0, end: 10 })
    expect(out[1].audio).toEqual({ start: 10, end: 20 })
  })

  it('同一块内的多个句子按词比例细分', () => {
    // 四个词落在一整块 [0,4) 上，两句各两词 → 前半 0~5，后半 5~10
    const oneChunk: Chunk[] = [{ index: 0, start: 0, end: 10 }]
    const out = alignSentences([s('s001', 'one two'), s('s002', 'three four')], oneChunk)
    expect(out[0].audio).toEqual({ start: 0, end: 5 })
    expect(out[1].audio).toEqual({ start: 5, end: 10 })
  })

  it('没有块时全部为 null', () => {
    const out = alignSentences([s('s001', 'hi')], [])
    expect(out[0].audio).toBeNull()
  })

  it('空句子保持 null', () => {
    const out = alignSentences([s('s001', 'hi'), s('s002', '')], chunks)
    expect(out[1].audio).toBeNull()
  })

  it('不改动其他字段，也不改原对象', () => {
    const input = [s('s001', 'alpha beta')]
    const out = alignSentences(input, chunks)
    expect(input[0].audio).toBeNull()
    expect(out[0].text).toBe('alpha beta')
  })

  it('时长保留两位小数', () => {
    const odd: Chunk[] = [{ index: 0, start: 0.123, end: 9.876 }]
    const out = alignSentences([s('s001', 'one two three')], odd)
    expect(out[0].audio?.start).toBe(0.12)
    expect(out[0].audio?.end).toBe(9.88)
  })
})
