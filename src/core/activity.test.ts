import { describe, it, expect } from 'vitest'
import {
  activityStreak,
  addActivity,
  buildHeatmap,
  calendarDayKey,
  dayKeyLocal,
  dayTotal,
  levelFor,
  normalizeActivity,
  sumCats,
  type DayActivity,
} from './activity'

describe('dayKeyLocal / calendarDayKey（结算点 04:00）', () => {
  it('白天用当天；凌晨（00:00–03:59）算前一天', () => {
    expect(dayKeyLocal(new Date(2026, 9, 3, 10, 0))).toBe('2026-10-03')
    expect(dayKeyLocal(new Date(2026, 9, 3, 3, 59))).toBe('2026-10-02') // 凌晨 → 前一天
    expect(dayKeyLocal(new Date(2026, 9, 3, 4, 0))).toBe('2026-10-03') // 4 点整 → 新的一天
    expect(dayKeyLocal(new Date(2026, 9, 3, 0, 0))).toBe('2026-10-02')
  })
  it('calendarDayKey 就是那一天（不做结算偏移）', () => {
    expect(calendarDayKey(new Date(2026, 9, 3, 0, 0))).toBe('2026-10-03')
    expect(calendarDayKey(new Date(2026, 9, 3, 23, 59))).toBe('2026-10-03')
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
    expect(activityStreak(list, new Date(2026, 9, 3, 10, 0))).toBe(3)
    // 今天还没记，但昨天有 → 从昨天数
    expect(activityStreak(list, new Date(2026, 9, 4, 10, 0))).toBe(3)
    // 断档
    expect(activityStreak(list, new Date(2026, 9, 6, 10, 0))).toBe(0)
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
  const today = new Date(2026, 9, 3, 10, 0) // 2026-10-03（白天，逻辑日=日历日）
  it('列数 / 行数正确，今天落在最后一列', () => {
    const hm = buildHeatmap({}, 13, today)
    expect(hm.columns).toBe(13)
    expect(hm.cells).toHaveLength(13)
    expect(hm.cells.every((c) => c.length === 7)).toBe(true)
    const last = hm.cells[12]
    const todayCell = last[today.getDay()]
    expect(todayCell.key).toBe(calendarDayKey(today))
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
  it('可以自定义色阶函数（如目标：1/2/3/4+ 篇）', () => {
    const hm = buildHeatmap({ [calendarDayKey(today)]: 2 }, 13, today, (n) => Math.min(4, n))
    const cell = hm.cells[12][today.getDay()]
    expect(cell.count).toBe(2)
    expect(cell.level).toBe(2)
  })
  it('凌晨 1 点的活动算前一天（04:00 结算），落在前一天的格子里', () => {
    const at1am = new Date(2026, 9, 16, 1, 0)
    expect(dayKeyLocal(at1am)).toBe('2026-10-15')
    const hm = buildHeatmap({ [dayKeyLocal(at1am)]: 5 }, 13, new Date(2026, 9, 16, 10, 0))
    const cell = hm.cells.flat().find((c) => c.key === '2026-10-15')
    expect(cell?.count).toBe(5)
    const next = hm.cells.flat().find((c) => c.key === '2026-10-16')
    expect(next?.count).toBe(0)
  })
  it('有月份标注', () => {
    const hm = buildHeatmap({}, 13, today)
    expect(hm.monthLabels.length).toBeGreaterThan(0)
    expect(hm.monthLabels.every((m) => m.col >= 0 && m.col < 13)).toBe(true)
  })

  it('日期与格子的对应关系锁死：最后一列 = 本周，行 = 周几', () => {
    const thu = new Date(2026, 9, 15) // 2026-10-15 周四（getDay=4）
    const hm = buildHeatmap({ '2026-07-19': 1, '2026-10-15': 2 }, 13, thu)
    expect(hm.cells[0][0].key).toBe('2026-07-19') // 13 周前那个周日
    expect(hm.cells[12][4].key).toBe('2026-10-15') // 本周（最后一列）第 4 行 = 周四
    expect(hm.cells[12][4].count).toBe(2)
    expect(hm.cells[12][5].future).toBe(true) // 周五还没到
    // 每一列的 7 格必须是连续 7 天
    for (let c = 0; c < 13; c++) {
      const days = hm.cells[c].map((x) => x.key)
      expect(new Set(days).size).toBe(7)
    }
  })
})

describe('normalizeActivity（元素级守卫）', () => {
  it('丢掉 null / day 非字符串 / counts 非对象，好的照常保留', () => {
    const out = normalizeActivity([
      null,
      'x',
      { day: 5, counts: { speak: 2 } },
      { day: '2026-10-01', counts: null },
      { day: '2026-10-02', counts: { speak: 2, bad: 1, read: -1 } },
    ])
    expect(out).toEqual([{ day: '2026-10-02', counts: { speak: 2 } }])
  })

  it('非数组 → 空数组', () => {
    expect(normalizeActivity({ day: '2026-10-01', counts: {} })).toEqual([])
  })
})
