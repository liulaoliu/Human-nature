import { describe, expect, it } from 'vitest'
import { auditHookSizes } from './check_hook_size.mjs'

const base = { 'src/reader/hooks/useOld.ts': 600 }

describe('hook 体量门禁', () => {
  it('新 hook 超 500 行失败；480–500 只提醒', () => {
    const bad = auditHookSizes([{ file: 'src/reader/hooks/useNew.ts', lines: 501 }], {})
    expect(bad.violations.join('\n')).toContain('> 上限 500')
    const warn = auditHookSizes([{ file: 'src/reader/hooks/useNew.ts', lines: 490 }], {})
    expect(warn.violations).toEqual([])
    expect(warn.warnings.join('\n')).toContain('接近 500')
  })

  it('存量基线变大失败，变小只提示下调，达标仍未删基线也失败', () => {
    const grown = auditHookSizes([{ file: 'src/reader/hooks/useOld.ts', lines: 601 }], base)
    expect(grown.violations.join('\n')).toContain('> 基线 600')
    const shrunk = auditHookSizes([{ file: 'src/reader/hooks/useOld.ts', lines: 580 }], base)
    expect(shrunk.violations).toEqual([])
    expect(shrunk.notes.join('\n')).toContain('下调到 580')
    const clean = auditHookSizes([{ file: 'src/reader/hooks/useOld.ts', lines: 500 }], base)
    expect(clean.violations.join('\n')).toContain('从 BASELINE 删除')
  })

  it('基线文件不存在也会提醒销账', () => {
    const res = auditHookSizes([], base)
    expect(res.violations.join('\n')).toContain('已经不存在')
  })
})
