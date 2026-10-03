import { describe, it, expect } from 'vitest'
import { diffWords, dictationWrongWords, wordTokens } from './dictation'

describe('wordTokens', () => {
  it('按空白切词、去空', () => {
    expect(wordTokens('  The quick  fox ')).toEqual(['The', 'quick', 'fox'])
    expect(wordTokens('')).toEqual([])
  })
})

describe('diffWords', () => {
  it('完全一致 → correct', () => {
    const r = diffWords('The quick brown fox.', 'the quick brown fox')
    expect(r.correct).toBe(true)
    expect(r.missed).toEqual([])
    expect(r.extra).toEqual([])
    expect(r.tokens.every((t) => t.type === 'same')).toBe(true)
  })
  it('漏词 → del / missed', () => {
    const r = diffWords('The quick brown fox', 'the quick fox')
    expect(r.correct).toBe(false)
    expect(r.missed).toEqual(['brown'])
    expect(r.tokens.some((t) => t.type === 'del' && t.text === 'brown')).toBe(true)
  })
  it('多词 → ins / extra', () => {
    const r = diffWords('The quick fox', 'the very quick fox')
    expect(r.extra).toEqual(['very'])
  })
  it('拼错 → 同时漏写与多写', () => {
    const r = diffWords('The quick brown fox', 'the quik brown fox')
    expect(r.missed).toEqual(['quick'])
    expect(r.extra).toEqual(['quik'])
  })
  it('大小写 / 标点不敏感', () => {
    expect(diffWords('Hello, world!', 'hello world').correct).toBe(true)
  })
})

describe('dictationWrongWords', () => {
  it('取漏写词并去重', () => {
    const r = diffWords('run fast and run far', 'run and run far')
    expect(dictationWrongWords(r)).toEqual(['fast'])
  })
  it('全对时为空', () => {
    expect(dictationWrongWords(diffWords('a b c', 'A B C'))).toEqual([])
  })
})
