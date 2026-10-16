import { describe, it, expect } from 'vitest'
import {
  addReadDone,
  goalPct,
  goalReached,
  groupReadDone,
  mergeReadDone,
  readDayOf,
  readDoneOn,
  readDoneTotals,
  removeReadDone,
  type ReadDone,
} from './goals'

const e = (day: string, articleId: string, title = articleId, at = `${day}T10:00:00.000Z`): ReadDone => ({
  day,
  articleId,
  title,
  at,
})

describe('addReadDone / readDoneOn / removeReadDone', () => {
  it('同一篇只记第一次：换一天重读也不算（第二天不会又被列入）', () => {
    let list = addReadDone([], e('2026-10-15', 'a1'))
    list = addReadDone(list, e('2026-10-15', 'a1', 'again', '2026-10-15T11:00:00.000Z'))
    expect(list).toHaveLength(1)
    // 换了天，同一篇仍然不重复计入
    list = addReadDone(list, e('2026-10-16', 'a1'))
    expect(list).toHaveLength(1)
    expect(list[0].day).toBe('2026-10-15') // 保留第一次那天
    // 另一篇算新的
    expect(addReadDone(list, e('2026-10-16', 'a2'))).toHaveLength(2)
  })

  it('空 articleId 不记', () => {
    expect(addReadDone([], e('2026-10-15', ''))).toHaveLength(0)
  })

  it('readDoneOn 只取那天，按时间排序；remove 可撤销（不分哪天）', () => {
    const list = [e('2026-10-15', 'a2', 'B', '2026-10-15T12:00:00.000Z'), e('2026-10-15', 'a1', 'A'), e('2026-10-14', 'a0')]
    expect(readDoneOn(list, '2026-10-15').map((x) => x.articleId)).toEqual(['a1', 'a2'])
    expect(removeReadDone(list, 'a1').map((x) => x.articleId)).toEqual(['a2', 'a0'])
  })

  it('readDayOf / groupReadDone / readDoneTotals', () => {
    const list = [e('2026-10-15', 'a2'), e('2026-10-15', 'a1'), e('2026-10-13', 'a0'), e('2026-10-14', 'a3')]
    expect(readDayOf(list, 'a0')).toBe('2026-10-13')
    expect(readDayOf(list, 'zz')).toBeNull()
    expect(readDayOf(list, null)).toBeNull()
    const g = groupReadDone(list)
    expect(g.map((x) => [x.day, x.items.length])).toEqual([
      ['2026-10-15', 2],
      ['2026-10-14', 1],
      ['2026-10-13', 1],
    ])
    expect(readDoneTotals(list)).toEqual({ articles: 4, days: 3 })
  })

  it('mergeReadDone：按 articleId 合并去重', () => {
    const a = [e('2026-10-15', 'a1')]
    const b = [e('2026-10-15', 'a1'), e('2026-10-16', 'a2')]
    expect(mergeReadDone(a, b).map((x) => x.articleId)).toEqual(['a1', 'a2'])
    // 已有的那条不被覆盖（保留第一次那天）
    expect(mergeReadDone(a, [e('2026-10-20', 'a1')])[0].day).toBe('2026-10-15')
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
