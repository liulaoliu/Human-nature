import { describe, expect, it } from 'vitest'
import { parseRecentRefs, pushRecentRef, RECENT_LIMIT } from './recentArticles'

describe('parseRecentRefs', () => {
  it('只认 b:/s: 开头的字符串，去重并截断', () => {
    expect(
      parseRecentRefs(['b:A', 's:1', 'b:A', 'nope', 42, 's:']),
    ).toEqual(['b:A', 's:1'])
  })

  it('坏数据当空表', () => {
    expect(parseRecentRefs(null)).toEqual([])
    expect(parseRecentRefs('b:A')).toEqual([])
    expect(parseRecentRefs([{ ref: 'b:A' }])).toEqual([])
  })

  it(`最多 ${RECENT_LIMIT} 条`, () => {
    const raw = Array.from({ length: 10 }, (_, i) => `s:${i}`)
    expect(parseRecentRefs(raw)).toHaveLength(RECENT_LIMIT)
  })
})

describe('pushRecentRef', () => {
  it('最近打开的放最前，已有的挪上来而不是重复一条', () => {
    expect(pushRecentRef(['b:A', 's:1'], 's:1')).toEqual(['s:1', 'b:A'])
    expect(pushRecentRef(['b:A'], 'b:B')).toEqual(['b:B', 'b:A'])
  })

  it('超出上限时挤掉最旧的', () => {
    expect(pushRecentRef(['s:4', 's:3', 's:2', 's:1', 's:0'], 's:5')).toEqual([
      's:5',
      's:4',
      's:3',
      's:2',
      's:1',
    ])
  })

  it('非法 ref 不动原列表', () => {
    expect(pushRecentRef(['b:A'], '')).toEqual(['b:A'])
    expect(pushRecentRef(['b:A'], 'nope')).toEqual(['b:A'])
  })
})
