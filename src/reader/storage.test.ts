import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { readJson, readNum, readRaw, removeRaw, writeJson, writeNum, writeRaw } from './storage'

/**
 * 面板本地状态的安全读写。
 * 重点是「拿不到 / 写不进 / 数据坏」都不许抛 —— 隐私模式下抛异常会把整页打崩。
 *
 * 这里**自己注入一个假 localStorage**（跑在快的 node 环境，不依赖 jsdom）：
 * 顺便也就证明了模块只依赖浏览器那套接口（getItem/setItem/removeItem）。
 */
function fakeStorage(overrides: Partial<Storage> = {}): Storage {
  const map = new Map<string, string>()
  return {
    get length() {
      return map.size
    },
    clear: () => map.clear(),
    getItem: (k: string) => map.get(k) ?? null,
    key: (i: number) => [...map.keys()][i] ?? null,
    removeItem: (k: string) => void map.delete(k),
    setItem: (k: string, v: string) => void map.set(k, String(v)),
    ...overrides,
  } as Storage
}

/**
 * 注入/还原：Node 26 自带一个 localStorage（且是只读的全局 getter），
 * 直接赋值会静默失败 —— 所以用 defineProperty 覆盖，测完再还原。
 */
function setLocalStorage(value: Storage | undefined): void {
  Object.defineProperty(globalThis, 'localStorage', { value, configurable: true, writable: true })
}
const cd = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')

beforeEach(() => setLocalStorage(fakeStorage()))
afterEach(() => {
  if (cd) Object.defineProperty(globalThis, 'localStorage', cd)
})

describe('storage：正常读写', () => {
  it('字符串 / JSON / 数字 三类往返', () => {
    writeRaw('k1', 'v1')
    expect(readRaw('k1')).toBe('v1')

    writeJson('k2', { a: [1, 2], b: '中' })
    expect(readJson('k2', null)).toEqual({ a: [1, 2], b: '中' })

    writeNum('k3', 7)
    expect(readNum('k3', 0)).toBe(7)

    removeRaw('k3')
    expect(readRaw('k3')).toBeNull()
    expect(readNum('k3', 42)).toBe(42)
  })
})

describe('storage：坏数据与异常都不抛', () => {
  it('不是 JSON / 是 null 字面量 → 给 fallback', () => {
    writeRaw('bad', '{ok: no}')
    expect(readJson('bad', { safe: true })).toEqual({ safe: true })
    writeRaw('nil', 'null')
    expect(readJson('nil', 'fb')).toBe('fb')
  })

  it('数字键存了垃圾 → fallback；1.9 → 1（面板只关心整数游标）', () => {
    writeRaw('num', 'abc')
    expect(readNum('num', 5)).toBe(5)
    writeRaw('num2', '1.9')
    expect(readNum('num2', 0)).toBe(1)
  })

  it('连取都用不了（隐私模式：getItem/setItem 抛）→ 一律降级，不影响流程', () => {
    setLocalStorage(
      fakeStorage({
        getItem: () => {
          throw new Error('denied')
        },
        setItem: () => {
          throw new Error('quota')
        },
      }),
    )
    expect(readRaw('k')).toBeNull()
    expect(readJson('k', 'fb')).toBe('fb')
    expect(readNum('k', 3)).toBe(3)
    expect(writeRaw('k', 'v')).toBe(false)
    expect(() => writeJson('k', { v: 1 })).not.toThrow()
    expect(() => removeRaw('k')).not.toThrow()
  })

  it('完全没有 localStorage（无 DOM / 沙箱）也不抛', () => {
    setLocalStorage(undefined)
    expect(readRaw('k')).toBeNull()
    expect(readJson('k', 'fb')).toBe('fb')
    expect(readNum('k', 3)).toBe(3)
    expect(writeRaw('k', 'v')).toBe(false)
    expect(() => writeJson('k', { v: 1 })).not.toThrow()
  })

  it('JSON.stringify 失败（循环引用）不抛', () => {
    const cyc: Record<string, unknown> = {}
    cyc.self = cyc
    expect(() => writeJson('cyc', cyc)).not.toThrow()
  })
})
