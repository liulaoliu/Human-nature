import { describe, it, expect } from 'vitest'
import { activeLemmasOf, allLemmas, libraryLemmaSet, sentenceLemmaSets, vocabSentenceIds } from './vocabSets'
import { vocabItem } from './testFixtures'

/**
 * 「正文里哪些词算生词」——高亮、编号、a/d 跳转共用这一层，规则飘了就会出现
 * 「明明有词却不亮」或「点 A/D 找不到句子」。这里把规则钉住。
 */
const sentences = [
  { id: 's1', text: 'The cat sat on the mat.' },
  { id: 's2', text: 'A dog barked.' },
]

describe('sentenceLemmaSets / allLemmas', () => {
  it('每句抽出出现过的 lemma；全文取并集', () => {
    const sets = sentenceLemmaSets(sentences)
    expect([...sets.get('s1')!].sort()).toEqual(['cat', 'mat', 'on', 'sat', 'the'])
    expect([...allLemmas(sets)].sort()).toEqual(['a', 'bark', 'cat', 'dog', 'mat', 'on', 'sat', 'the'])
  })

  it('空输入不炸', () => {
    expect(sentenceLemmaSets(null).size).toBe(0)
    expect(allLemmas(new Map()).size).toBe(0)
  })
})

describe('activeLemmasOf / libraryLemmaSet', () => {
  const items = [
    vocabItem({ id: 'a', word: 'cats', lemma: 'cat', status: 'queried' }),
    vocabItem({ id: 'b', word: 'Dog', lemma: 'dog', status: 'mastered' }),
  ]

  it('a/d 只认未掌握的词（词形 + lemma 都算）', () => {
    const active = activeLemmasOf(items)
    expect(active.has('cat')).toBe(true)
    expect(active.has('cats')).toBe(true)
    expect(active.has('dog')).toBe(false) // 已掌握：不再跳
  })

  it('「已在生词本」用全量（含已掌握）', () => {
    const lib = libraryLemmaSet(items)
    expect(lib.has('cat')).toBe(true)
    expect(lib.has('dog')).toBe(true)
  })
})

describe('vocabSentenceIds', () => {
  it('这句里有未掌握的词就算（正文顺序）', () => {
    const sets = sentenceLemmaSets(sentences)
    const ids = vocabSentenceIds(sentences, sets, activeLemmasOf([vocabItem({ word: 'dog', lemma: 'dog' })]), new Set())
    expect(ids).toEqual(['s2'])
  })

  it('待选清单指到过的句子也算（哪怕词条还没入库）', () => {
    const sets = sentenceLemmaSets(sentences)
    const ids = vocabSentenceIds(sentences, sets, new Set(), new Set(['s1']))
    expect(ids).toEqual(['s1'])
  })

  it('都没有 → 空数组', () => {
    expect(vocabSentenceIds(sentences, sentenceLemmaSets(sentences), new Set(), new Set())).toEqual([])
  })
})
