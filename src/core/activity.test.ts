import { describe, it, expect } from 'vitest'
import {
  activityStreak,
  addActivity,
  buildHeatmap,
  dayKeyLocal,
  dayTotal,
  levelFor,
  sumCats,
  type DayActivity,
} from './activity'

describe('dayKeyLocal', () => {
  it('本地 YYYY-MM-DD', () => {
    expect(dayKeyLocal(new Date(2026, 9, 3))).toBe('2026-10-03')
  })
})

describe('addActivity', () => {
  it('新增一天', () => {
    const out = addActivity([], '2026-10-03', 'vocab', 2)
    expect(out).toEqual([{ day: '2026-10-03', counts: { vocab: 2 } }])
  })
  it('同一天同类累加、不同类并存', () => {
    let list: DayActivity[] = []
    list = addActivity(list, '2026-10-03', 'vocab', 2)
    list = addActivity(list, '2026-10-03', 'vocab', 3)
    list = addActivity(list, '2026-10-03', 'listen', 1)
    expect(list[0].counts).toEqual({ vocab: 5, listen: 1 })
  })
  it('按日期排序、按上限截断', () => {
    let list: DayActivity[] = []
    list = addActivity(list, '2026-10-03', 'vocab')
    list = addActivity(list, '2026-10-01', 'vocab')
    list = addActivity(list, '2026-10-02', 'vocab')
    expect(list.map((a) => a.day)).toEqual(['2026-10-01', '2026-10-02', '2026-10-03'])
    let capped: DayActivity[] = []
    for (let i = 0; i < 5; i++) capped = addActivity(capped, `2026-10-0${i + 1}`, 'vocab', 1, 3)
    expect(capped).toHaveLength(3)
    expect(capped.map((a) => a.day)).toEqual(['2026-10-03', '2026-10-04', '2026-10-05'])
  })
  it('n<=0 或空日期不动', () => {
    expect(addActivity([], '2026-10-03', 'vocab', 0)).toEqual([])
    expect(addActivity([], '', 'vocab', 1)).toEqual([])
  })
})

describe('dayTotal / sumCats', () => {
  const list: DayActivity[] = [
    { day: '2026-10-01', counts: { read: 2, vocab: 3 } },
    { day: '2026-10-02', counts: { listen: 1 } },
    { day: '2026-10-03', counts: { write: 4, speak: 1 } },
  ]
  it('dayTotal 求和', () => {
    expect(dayTotal(list[0])).toBe(5)
  })
  it('sumCats 按区间合计', () => {
    expect(sumCats(list, '2026-10-01', '2026-10-02')).toEqual({
      read: 2,
      vocab: 3,
      listen: 1,
      write: 0,
      speak: 0,
    })
    expect(sumCats(list, '2026-10-03', '2026-10-03').write).toBe(4)
  })
})

describe('activityStreak', () => {
  it('从今天/昨天往前数连续天数', () => {
    const list: DayActivity[] = [
      { day: '2026-10-01', counts: { vocab: 1 } },
      { day: '2026-10-02', counts: { vocab: 1 } },
      { day: '2026-10-03', counts: { vocab: 1 } },
    ]
    expect(activityStreak(list, new Date(2026, 9, 3))).toBe(3)
    // 今天还没记，但昨天有 → 从昨天数
    expect(activityStreak(list, new Date(2026, 9, 4))).toBe(3)
    // 断档
    expect(activityStreak(list, new Date(2026, 9, 6))).toBe(0)
  })
})

describe('levelFor', () => {
  it('色阶阈值', () => {
    expect(levelFor(0)).toBe(0)
    expect(levelFor(1)).toBe(1)
    expect(levelFor(2)).toBe(1)
    expect(levelFor(3)).toBe(2)
    expect(levelFor(6)).toBe(3)
    expect(levelFor(10)).toBe(4)
  })
})

describe('buildHeatmap', () => {
  const today = new Date(2026, 9, 3) // 2026-10-03
  it('列数 / 行数正确，今天落在最后一列', () => {
    const hm = buildHeatmap({}, 13, today)
    expect(hm.columns).toBe(13)
    expect(hm.cells).toHaveLength(13)
    expect(hm.cells.every((c) => c.length === 7)).toBe(true)
    const last = hm.cells[12]
    const todayCell = last[today.getDay()]
    expect(todayCell.key).toBe(dayKeyLocal(today))
    expect(todayCell.future).toBe(false)
  })
  it('未来日期留空', () => {
    const hm = buildHeatmap({}, 13, today)
    const last = hm.cells[12]
    const future = last.filter((c) => c.future)
    expect(future.length).toBe(6 - today.getDay())
    expect(future.every((c) => c.count === 0 && c.level === 0)).toBe(true)
  })
  it('counts 映射到色阶与 max', () => {
    const hm = buildHeatmap({ [dayKeyLocal(today)]: 6 }, 13, today)
    const cell = hm.cells[12][today.getDay()]
    expect(cell.count).toBe(6)
    expect(cell.level).toBe(3)
    expect(hm.max).toBe(6)
  })
  it('有月份标注', () => {
    const hm = buildHeatmap({}, 13, today)
    expect(hm.monthLabels.length).toBeGreaterThan(0)
    expect(hm.monthLabels.every((m) => m.col >= 0 && m.col < 13)).toBe(true)
  })
})
