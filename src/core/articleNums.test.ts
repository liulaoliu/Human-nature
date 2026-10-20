import { describe, it, expect } from 'vitest'
import { articleNumbering } from './articleNums'
import type { ArticleVocabEntry } from '../types/document'

/**
 * 正文生词编号：只按**本篇条目加入顺序**从 1 开始。
 * 自动标词一批由调用方按正文顺序加入；删除条目后数组自然重排，不留空号。
 */
const sentences = [
  { id: 's1', text: 'The cat sat on the mat.' },
  { id: 's2', text: 'A dog barked at the cat.' },
]
const entry = (lemma: string): ArticleVocabEntry => ({
  articleId: 'art-A',
  lemma,
  origin: 'manual',
  addedAt: '2026-10-01T10:00:00Z',
})

describe('articleNumbering（按篇条目顺序）', () => {
  it('按条目加入顺序编号，与 createdAt / 字母序无关', () => {
    const { nums } = articleNumbering(sentences, [entry('dog'), entry('cat')])
    expect(nums.get('dog')).toBe(1)
    expect(nums.get('cat')).toBe(2)
  })

  it('删除中间条目后紧凑重排', () => {
    const { nums } = articleNumbering(sentences, [entry('cat'), entry('dog')])
    expect([...nums.entries()]).toEqual([
      ['cat', 1],
      ['dog', 2],
    ])
  })

  it('正文里没出现的词仍占编号（它还在本篇词表里），只是没有上标位置', () => {
    const { nums, firstOccurrence } = articleNumbering(sentences, [entry('zebra'), entry('cat')])
    expect(nums.get('zebra')).toBe(1)
    expect(nums.get('cat')).toBe(2)
    expect([...firstOccurrence]).toEqual(['s1:1'])
  })

  it('firstOccurrence：只在正文首次出现处打标（含词的位置）', () => {
    const { firstOccurrence } = articleNumbering(sentences, [entry('cat')])
    expect([...firstOccurrence]).toEqual(['s1:1']) // s1 的第 2 个词（0 基）是 cat
  })

  it('重复 lemma 只认第一次，不产生两个编号', () => {
    const { nums } = articleNumbering(sentences, [entry('cat'), entry('cat'), entry('dog')])
    expect([...nums.entries()]).toEqual([
      ['cat', 1],
      ['dog', 2],
    ])
  })

  it('空输入不炸', () => {
    expect(articleNumbering(null, [entry('cat')]).nums.size).toBe(1)
    expect(articleNumbering(null, []).nums.size).toBe(0)
    expect(articleNumbering([], []).firstOccurrence.size).toBe(0)
  })
})
