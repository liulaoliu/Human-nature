import { describe, it, expect } from 'vitest'
import { isRecord, asRecord } from './guards.ts'

describe('guards（JSON 边界守卫）', () => {
  it('isRecord：对象/数组放行，原始值与 null/undefined 拒绝', () => {
    expect(isRecord({})).toBe(true)
    expect(isRecord({ a: 1 })).toBe(true)
    expect(isRecord([])).toBe(true)
    expect(isRecord(null)).toBe(false)
    expect(isRecord(undefined)).toBe(false)
    expect(isRecord('x')).toBe(false)
    expect(isRecord(5)).toBe(false)
    expect(isRecord(false)).toBe(false)
  })
  it('asRecord：放行的原样返回（同一引用，不拷贝），拒绝的返回 null', () => {
    const o = { a: 1 }
    expect(asRecord(o)).toBe(o)
    expect(asRecord([1, 2]).length).toBe(2)
    expect(asRecord(null)).toBeNull()
    expect(asRecord(undefined)).toBeNull()
    expect(asRecord('x')).toBeNull()
    expect(asRecord(0)).toBeNull()
  })
})
