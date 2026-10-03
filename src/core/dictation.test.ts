import { describe, it, expect } from 'vitest'
import {
  diffWords,
  dictationWrongWords,
  isClozeBlankCorrect,
  makeCloze,
  pickBlankTargets,
  splitForDictation,
  wordTokens,
} from './dictation'

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

describe('splitForDictation', () => {
  it('按逗号/分号/冒号切短', () => {
    expect(splitForDictation('The plan was bold, the budget was tight, and the team was small.')).toEqual([
      'The plan was bold,',
      'the budget was tight,',
      'and the team was small.',
    ])
  })
  it('没有标点的长句按词硬切', () => {
    const words = Array.from({ length: 25 }, (_, i) => `w${i}`).join(' ')
    expect(splitForDictation(words, 10).map((s) => s.split(' ').length)).toEqual([10, 10, 5])
  })
  it('空串 → []', () => {
    expect(splitForDictation('   ')).toEqual([])
  })
})

describe('pickBlankTargets / makeCloze', () => {
  const sentence = 'Regulators expect the company to disclose its findings soon.'
  it('优先挑词库里的词', () => {
    const pool = new Set(['disclose', 'findings'])
    const targets = pickBlankTargets(sentence, pool, 2, () => 0.5)
    expect(targets.sort()).toEqual(['disclose', 'findings'])
  })
  it('没有词库词时挑较长实词（不挖虚词）', () => {
    const targets = pickBlankTargets(sentence, new Set(), 2, () => 0.5)
    expect(targets.length).toBeGreaterThan(0)
    expect(targets.every((t) => t.toLowerCase() !== 'the' && t.toLowerCase() !== 'to')).toBe(true)
  })
  it('makeCloze 挖空并给答案', () => {
    const q = makeCloze(sentence, ['disclose'])
    expect(q.display).toContain('____')
    expect(q.display).not.toContain('disclose')
    expect(q.blanks).toHaveLength(1)
    expect(q.blanks[0].answer).toBe('disclose')
  })
})

describe('isClozeBlankCorrect', () => {
  const blank = { answer: 'findings', accept: ['findings', 'finding'] }
  it('大小写/标点宽松', () => {
    expect(isClozeBlankCorrect(blank, 'Findings.')).toBe(true)
    expect(isClozeBlankCorrect(blank, 'finding')).toBe(true)
    expect(isClozeBlankCorrect(blank, 'results')).toBe(false)
  })
})
