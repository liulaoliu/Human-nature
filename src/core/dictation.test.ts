import { describe, it, expect } from 'vitest'
import {
  diffWords,
  dictationWrongWords,
  isClozeBlankCorrect,
  makeCloze,
  packSegments,
  pickBlankTargets,
  splitForDictation,
  takeRound,
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
  it('长数字不被逗号切断', () => {
    expect(splitForDictation('Sales rose to 1,234,567 last year.')).toEqual(['Sales rose to 1,234,567 last year.'])
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
    expect(q.display).toContain('[1]')
    expect(q.display).not.toContain('disclose')
    expect(q.blanks).toHaveLength(1)
    expect(q.blanks[0].answer).toBe('disclose')
  })
  it('makeCloze 多处挖空带编号，parts 记录原文位置', () => {
    const q = makeCloze('The findings disclose a major problem.', ['findings', 'disclose'])
    expect(q.display).toContain('[1]')
    expect(q.display).toContain('[2]')
    expect(q.blanks.map((b) => b.answer)).toEqual(['findings', 'disclose'])
    const blanks = q.parts.filter((p) => p.blank)
    expect(blanks.map((p) => p.index)).toEqual([1, 2])
    // 每个空的位置都对应原文里的那个词
    for (const p of blanks) expect(q.sentence.slice(p.start, p.start + p.text.length)).toBe(p.text)
    // 拼回 display：把编号换回词形应等于原文
    const rebuilt = q.parts.map((p) => p.text).join('')
    expect(rebuilt).toBe(q.sentence)
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

describe('packSegments', () => {
  it('按 maxWords 把相邻句并成一段', () => {
    const segs = packSegments(['one two three', 'four five six', 'seven eight nine'], 6)
    expect(segs).toEqual(['one two three four five six', 'seven eight nine'])
  })
  it('单句超过 maxWords 也自成一整段（不切句）', () => {
    expect(packSegments(['a b c d e f'], 3)).toEqual(['a b c d e f'])
  })
  it('跳过空句', () => {
    expect(packSegments(['hi there', '   ', 'ok go'], 10)).toEqual(['hi there ok go'])
  })
})

describe('takeRound', () => {
  const items = ['a', 'b', 'c', 'd', 'e']
  it('max<=0 或总量不足 → 全取且 cursor 归零', () => {
    expect(takeRound(items, 2, 0)).toEqual({ items, next: 0, offset: 0 })
    expect(takeRound(items, 0, 10)).toEqual({ items, next: 0, offset: 0 })
  })
  it('从 cursor 取一段并给出下一个 cursor', () => {
    expect(takeRound(items, 0, 2)).toEqual({ items: ['a', 'b'], next: 2, offset: 0 })
    expect(takeRound(items, 2, 2)).toEqual({ items: ['c', 'd'], next: 4, offset: 2 })
  })
  it('到末尾 → 退回开头；越界 cursor 从 0 起', () => {
    expect(takeRound(items, 4, 2)).toEqual({ items: ['e'], next: 0, offset: 4 })
    expect(takeRound(items, 99, 2)).toEqual({ items: ['a', 'b'], next: 2, offset: 0 })
  })
})
