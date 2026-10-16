import { describe, it, expect } from 'vitest'
import { articleNumbering } from './articleNums'
import { vocabItem } from './testFixtures'

/**
 * 正文生词编号：手动标记顺序优先 → 同批（createdAt 相同）按正文出现顺序 → 字母序兜底。
 * 这条规则牵涉「自动标词后编号是不是文中顺序」这个用户体验，值得钉住。
 */
const sentences = [
  { id: 's1', text: 'The cat sat on the mat.' },
  { id: 's2', text: 'A dog barked at the cat.' },
]
const item = (word: string, createdAt: string) => vocabItem({ id: `vocab:${word}`, word, lemma: word, createdAt })

describe('articleNumbering', () => {
  it('手动标记顺序优先（createdAt 升序）', () => {
    const { nums } = articleNumbering(sentences, [item('dog', '2026-10-02T10:00:00Z'), item('cat', '2026-10-01T10:00:00Z')])
    expect(nums.get('cat')).toBe(1)
    expect(nums.get('dog')).toBe(2)
  })

  it('同一批（时间相同，如自动标词）按正文出现顺序编号', () => {
    const { nums } = articleNumbering(sentences, [
      item('dog', '2026-10-02T10:00:00Z'),
      item('cat', '2026-10-02T10:00:00Z'),
    ])
    expect(nums.get('cat')).toBe(1) // cat 在 s1 先出现
    expect(nums.get('dog')).toBe(2)
  })

  it('正文里没出现的词排最后（按字母序稳定）', () => {
    const { nums } = articleNumbering(sentences, [
      item('zebra', '2026-10-02T10:00:00Z'),
      item('apple', '2026-10-02T10:00:00Z'),
      item('cat', '2026-10-02T10:00:00Z'),
    ])
    expect(nums.get('cat')).toBe(1)
    expect([nums.get('apple'), nums.get('zebra')]).toEqual([2, 3])
  })

  it('firstOccurrence：只在正文首次出现处打标（含词的位置）', () => {
    const { firstOccurrence } = articleNumbering(sentences, [item('cat', '2026-10-01T10:00:00Z')])
    expect([...firstOccurrence]).toEqual(['s1:1']) // s1 的第 2 个词（0 基）是 cat
  })

  it('空输入不炸', () => {
    expect(articleNumbering(null, [item('cat', '2026-10-01T10:00:00Z')]).nums.size).toBe(0)
    expect(articleNumbering([], []).firstOccurrence.size).toBe(0)
  })
})
