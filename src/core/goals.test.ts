import { describe, it, expect } from 'vitest'
import { addReadDone, goalPct, goalReached, readDoneOn, removeReadDone, type ReadDone } from './goals'

const e = (day: string, articleId: string, title = articleId, at = `${day}T10:00:00.000Z`): ReadDone => ({
  day,
  articleId,
  title,
  at,
})

describe('addReadDone / readDoneOn / removeReadDone', () => {
  it('同一天同一篇只算一次', () => {
    let list = addReadDone([], e('2026-10-15', 'a1'))
    list = addReadDone(list, e('2026-10-15', 'a1', 'again', '2026-10-15T11:00:00.000Z'))
    expect(list).toHaveLength(1)
    // 不同天算新的
    list = addReadDone(list, e('2026-10-16', 'a1'))
    expect(list).toHaveLength(2)
  })

  it('空 articleId 不记', () => {
    expect(addReadDone([], e('2026-10-15', ''))).toHaveLength(0)
  })

  it('readDoneOn 只取那天，按时间排序；remove 可撤销', () => {
    const list = [e('2026-10-15', 'a2', 'B', '2026-10-15T12:00:00.000Z'), e('2026-10-15', 'a1', 'A'), e('2026-10-14', 'a0')]
    expect(readDoneOn(list, '2026-10-15').map((x) => x.articleId)).toEqual(['a1', 'a2'])
    expect(removeReadDone(list, '2026-10-15', 'a1').map((x) => x.articleId)).toEqual(['a2', 'a0'])
  })

  it('超过上限时留最近的', () => {
    let list: ReadDone[] = []
    for (let i = 0; i < 5; i++) list = addReadDone(list, e('2026-10-15', `a${i}`), 3)
    expect(list.map((x) => x.articleId)).toEqual(['a2', 'a3', 'a4'])
  })
})

describe('goalPct / goalReached', () => {
  it('按目标算百分比，封顶 100', () => {
    expect(goalPct(0, 2)).toBe(0)
    expect(goalPct(1, 2)).toBe(50)
    expect(goalPct(3, 2)).toBe(100)
  })
  it('不设目标（0）：读过算满，没读算 0，且不判定达成', () => {
    expect(goalPct(0, 0)).toBe(0)
    expect(goalPct(2, 0)).toBe(100)
    expect(goalReached(5, 0)).toBe(false)
    expect(goalReached(2, 2)).toBe(true)
  })
})
