import { describe, it, expect } from 'vitest'
import { Lru } from './lru'

describe('Lru', () => {
  it('存进去能取出来', () => {
    const c = new Lru<string, number>(3)
    c.set('a', 1)
    expect(c.get('a')).toBe(1)
    expect(c.size).toBe(1)
  })

  it('没存过返回 undefined', () => {
    const c = new Lru<string, number>(3)
    expect(c.get('x')).toBeUndefined()
  })

  it('超出容量丢最旧的', () => {
    const c = new Lru<string, number>(2)
    c.set('a', 1)
    c.set('b', 2)
    c.set('c', 3)
    expect(c.size).toBe(2)
    expect(c.get('a')).toBeUndefined() // 队首被丢了
    expect(c.get('b')).toBe(2)
    expect(c.get('c')).toBe(3)
  })

  it('命中会把这一条刷新成最新（不该被淘汰）', () => {
    const c = new Lru<string, number>(2)
    c.set('a', 1)
    c.set('b', 2)
    c.get('a') // a 变成最新，b 才是队首
    c.set('c', 3)
    expect(c.get('a')).toBe(1)
    expect(c.get('b')).toBeUndefined()
    expect(c.get('c')).toBe(3)
  })

  it('重复 set 同一个键不会撑大容量', () => {
    const c = new Lru<string, number>(2)
    c.set('a', 1)
    c.set('a', 2)
    c.set('a', 3)
    expect(c.size).toBe(1)
    expect(c.get('a')).toBe(3)
  })

  it('clear 清空', () => {
    const c = new Lru<string, number>(2)
    c.set('a', 1)
    c.clear()
    expect(c.size).toBe(0)
    expect(c.get('a')).toBeUndefined()
  })

  it('容量至少是 1', () => {
    expect(() => new Lru<string, number>(0)).toThrow()
    const c = new Lru<string, number>(1)
    c.set('a', 1)
    c.set('b', 2)
    expect(c.size).toBe(1)
    expect(c.get('a')).toBeUndefined()
  })
})
