import { describe, expect, it } from 'vitest'
import {
  DEFAULT_DRILL_LIMIT,
  DEFAULT_DRILL_LIMITS,
  DRILL_KINDS,
  DRILL_LIMIT_OPTIONS,
  isDrillLimit,
  normalizeDrillLimit,
  parseDrillLimits,
} from './intensiveDrill'

describe('intensiveDrill：七种入口各自的每次题数', () => {
  it('七种入口齐全，默认全部 10，档位包含默认值', () => {
    expect(DRILL_KINDS).toEqual(['memory', 'chunk', 'deep', 'mark', 'grammar', 'listen', 'siege'])
    expect(DEFAULT_DRILL_LIMIT).toBe(10)
    expect(DRILL_LIMIT_OPTIONS).toContain(DEFAULT_DRILL_LIMIT)
    for (const kind of DRILL_KINDS) expect(DEFAULT_DRILL_LIMITS[kind]).toBe(10)
  })

  it('合法档位原样保留（数字 / 数字字符串都认）', () => {
    for (const n of DRILL_LIMIT_OPTIONS) {
      expect(isDrillLimit(n)).toBe(true)
      expect(isDrillLimit(String(n))).toBe(true)
      expect(normalizeDrillLimit(n)).toBe(n)
      expect(normalizeDrillLimit(String(n))).toBe(n)
    }
  })

  it('坏数据 / 不在档位里的数 / 0 / 负数 → 回默认 10', () => {
    for (const bad of [undefined, null, '', 'abc', 0, -10, 7, 999, NaN, Infinity, true, []]) {
      expect(isDrillLimit(bad)).toBe(false)
      expect(normalizeDrillLimit(bad)).toBe(DEFAULT_DRILL_LIMIT)
    }
  })
})

describe('parseDrillLimits：坏一处只丢一处', () => {
  it('部分字段有效：有效的保留，缺的 / 坏的各自回默认', () => {
    expect(parseDrillLimits({ memory: 20, chunk: '30', deep: 7, mark: null })).toEqual({
      memory: 20,
      chunk: 30,
      deep: 10,
      mark: 10,
      grammar: 10,
      listen: 10,
      siege: 10,
    })
  })

  it('非对象 / 数组 / 未知键：回默认，不炸', () => {
    for (const bad of [null, undefined, 'nope', 123, [], [20]]) {
      expect(parseDrillLimits(bad)).toEqual(DEFAULT_DRILL_LIMITS)
    }
    expect(parseDrillLimits({ memory: 20, hack: 999 })).toMatchObject({ memory: 20, chunk: 10 })
  })

  it('返回的是新对象，不污染默认值', () => {
    const parsed = parseDrillLimits({ memory: 20 })
    parsed.chunk = 30
    expect(DEFAULT_DRILL_LIMITS).toMatchObject({ memory: 10, chunk: 10 })
  })
})
