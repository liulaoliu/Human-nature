import { describe, expect, it } from 'vitest'
import {
  DEFAULT_TOOLBAR_ROWS,
  TOOLBAR_GROUPS,
  TOOLBAR_ROWS_LABEL,
  TOOLBAR_ROW_MODES,
  parseToolbarRows,
  planToolbarRows,
  toolbarRowClass,
} from './toolbarRows'

describe('toolbarRows：顶栏行数档位', () => {
  it('默认是 4 行；脏值一律回 4', () => {
    expect(DEFAULT_TOOLBAR_ROWS).toBe(4)
    expect(parseToolbarRows(undefined)).toBe(4)
    expect(parseToolbarRows(null)).toBe(4)
    expect(parseToolbarRows('')).toBe(4)
    expect(parseToolbarRows('  ')).toBe(4)
    expect(parseToolbarRows('5')).toBe(4)
    expect(parseToolbarRows('3.5')).toBe(4)
    expect(parseToolbarRows('两行')).toBe(4)
    expect(parseToolbarRows(NaN)).toBe(4)
    expect(parseToolbarRows(Infinity)).toBe(4)
  })

  it('合法值照收：本机存的是字符串，直接传数字也认', () => {
    expect(parseToolbarRows('4')).toBe(4)
    expect(parseToolbarRows('3')).toBe(3)
    expect(parseToolbarRows('2')).toBe(2)
    expect(parseToolbarRows(2)).toBe(2)
    expect(parseToolbarRows(' 3 ')).toBe(3)
  })

  it('每档的档位与标签一一对应', () => {
    expect([...TOOLBAR_ROW_MODES]).toEqual([4, 3, 2])
    for (const m of TOOLBAR_ROW_MODES) expect(TOOLBAR_ROWS_LABEL[m]).toBe(`${m} 行`)
  })

  it('规划出来的行数就是选的档位', () => {
    for (const m of TOOLBAR_ROW_MODES) expect(planToolbarRows(m)).toHaveLength(m)
  })

  it('四组不丢、不重、不乱序（合并只改变分行，不改变顺序）', () => {
    for (const m of TOOLBAR_ROW_MODES) {
      const flat = planToolbarRows(m).flat()
      expect(flat).toEqual([...TOOLBAR_GROUPS])
      expect(new Set(flat).size).toBe(flat.length)
    }
  })

  it('4 行=每组各一行；3 行=动作与统计并；2 行=文章视图并、动作统计并', () => {
    expect(planToolbarRows(4)).toEqual([['doc'], ['view'], ['action'], ['status']])
    expect(planToolbarRows(3)).toEqual([['doc'], ['view'], ['action', 'status']])
    expect(planToolbarRows(2)).toEqual([
      ['doc', 'view'],
      ['action', 'status'],
    ])
  })

  it('统计组恒在最后一行（「显示 ⚙」才能一直贴在顶栏右端）', () => {
    for (const m of TOOLBAR_ROW_MODES) {
      const rows = planToolbarRows(m)
      expect(rows[rows.length - 1]).toContain('status')
    }
  })

  it('类名：单组用组名，合并行按组名连字符拼', () => {
    expect(toolbarRowClass(['doc'])).toBe('tb-row tb-row-doc')
    expect(toolbarRowClass(['action', 'status'])).toBe('tb-row tb-row-action-status')
    expect(toolbarRowClass([])).toBe('tb-row')
  })
})
