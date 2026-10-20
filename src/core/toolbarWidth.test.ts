import { describe, expect, it } from 'vitest'
import {
  isToolbarWidth,
  parseToolbarWidth,
  toolbarWidthStyle,
  TOOLBAR_MAX,
  TOOLBAR_MIN,
  TOOLBAR_WIDTHS,
} from './toolbarWidth'

describe('toolbarWidth：顶栏按钮区宽度档位', () => {
  it('四个档位都能认，其余一律不认', () => {
    for (const m of TOOLBAR_WIDTHS) expect(isToolbarWidth(m)).toBe(true)
    for (const bad of ['', 'big', 'AUTO', 0, null, undefined, {}]) expect(isToolbarWidth(bad)).toBe(false)
  })

  it('脏值回到自适应（不是窄也不是铺满）', () => {
    expect(parseToolbarWidth('huge')).toBe('auto')
    expect(parseToolbarWidth(null)).toBe('auto')
    expect(parseToolbarWidth('wide')).toBe('wide')
  })

  it('自适应 = 内容多宽就多宽（fit-content），不是写死像素', () => {
    const st = toolbarWidthStyle('auto')
    expect(st.width).toBe('fit-content')
    // 窗口再宽也还是这一块：不会拉到 TOOLBAR_MAX 那么宽
    expect(st.width).not.toContain(`${TOOLBAR_MAX}px`)
  })

  it('自适应有下限：800（窄屏退化成父容器宽度）', () => {
    expect(toolbarWidthStyle('auto').minWidth).toBe(`min(${TOOLBAR_MIN}px, 100%)`)
  })

  it('固定档给的是像素，同时带窄屏上限', () => {
    expect(toolbarWidthStyle('narrow').width).toBe('min(1000px, 100%)')
    expect(toolbarWidthStyle('wide').width).toBe('min(1400px, 100%)')
  })

  it('铺满档就是 100%（用户明确要铺满时的退路）', () => {
    const st = toolbarWidthStyle('full')
    expect(st.width).toBe('100%')
    expect(st.minWidth).toBeUndefined()
  })

  it('任何档位都不会算出空值 / NaN，且都带视窗上限', () => {
    for (const m of TOOLBAR_WIDTHS) {
      const st = toolbarWidthStyle(m)
      expect(st.width).toBeTruthy()
      expect(st.width).not.toContain('NaN')
      expect(st.maxWidth).toBeTruthy()
      if (st.minWidth) expect(st.minWidth).not.toContain('NaN')
    }
  })
})
