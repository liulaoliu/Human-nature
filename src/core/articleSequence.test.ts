import { describe, expect, it } from 'vitest'
import type { SavedArticle } from './ports'
import { articleNeighbors, articleSequence } from './articleSequence'

const saved = (id: string, title: string): SavedArticle => ({
  id,
  title,
  sourceKey: null,
  text: '',
  paragraphs: [],
  sentences: [],
  updatedAt: '2026-10-20T00:00:00.000Z',
})

const groups = (): [string, SavedArticle[]][] => [
  ['Book A', [saved('s2', 'A2'), saved('s1', 'A1')]],
  ['单篇', [saved('s3', 'Loose')]],
]

describe('articleSequence', () => {
  it('内置按 key 排序在前，已保存按分组顺序接在后面', () => {
    expect(articleSequence(['b2', 'a1'], groups())).toEqual([
      { ref: 'b:a1', title: 'a1' },
      { ref: 'b:b2', title: 'b2' },
      { ref: 's:s2', title: 'A2' },
      { ref: 's:s1', title: 'A1' },
      { ref: 's:s3', title: 'Loose' },
    ])
  })

  it('空目录 → 空序列', () => {
    expect(articleSequence([], [])).toEqual([])
  })
})

describe('articleNeighbors', () => {
  const seq = articleSequence(['a1', 'b2'], groups())

  it('中间一篇：前后都给', () => {
    expect(articleNeighbors(seq, 'b:b2')).toEqual({
      prev: { ref: 'b:a1', title: 'a1' },
      next: { ref: 's:s2', title: 'A2' },
      index: 1,
    })
  })

  it('第一篇没有上一篇，最后一篇没有下一篇', () => {
    expect(articleNeighbors(seq, 'b:a1').prev).toBeNull()
    expect(articleNeighbors(seq, 's:s3').next).toBeNull()
  })

  it('当前文章不在序列里（未保存的粘贴稿）→ 两边都没有', () => {
    expect(articleNeighbors(seq, '')).toEqual({ prev: null, next: null, index: -1 })
    expect(articleNeighbors(seq, 's:gone').next).toBeNull()
  })
})
