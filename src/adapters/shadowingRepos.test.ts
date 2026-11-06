import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { LocalCalibrationRepo } from './calibrationRepo'
import { LocalScriptEditRepo } from './scriptEditRepo'

// adapters 不能依赖 reader（架构门禁 R2），测试里用本地小假 storage。
const map = new Map<string, string>()
const fakeStorage = {
  get length() {
    return map.size
  },
  clear: () => map.clear(),
  getItem: (k: string) => map.get(k) ?? null,
  key: (i: number) => [...map.keys()][i] ?? null,
  removeItem: (k: string) => void map.delete(k),
  setItem: (k: string, v: string) => void map.set(k, String(v)),
} as Storage

let restoreStorage = () => {}

beforeEach(() => {
  map.clear()
  const desc = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
  Object.defineProperty(globalThis, 'localStorage', { value: fakeStorage, configurable: true, writable: true })
  restoreStorage = () => {
    if (desc) Object.defineProperty(globalThis, 'localStorage', desc)
    else Object.defineProperty(globalThis, 'localStorage', { value: undefined, configurable: true, writable: true })
  }
})
afterEach(() => {
  restoreStorage()
})

describe('LocalCalibrationRepo：坏 localStorage 不崩、不丢新写入', () => {
  it.each(['null', '[]', '"x"', '{', '{"a":{"offsetWords":"2"}}'])('坏值 %s → 读空、写新值', (raw) => {
    localStorage.setItem('shadowing.calibration.v1', raw)
    const repo = new LocalCalibrationRepo()
    expect(repo.get('a')).toBeUndefined()
    repo.set('b', { offsetWords: 2, textStartChunk: 1 })
    expect(repo.get('b')).toEqual({ offsetWords: 2, textStartChunk: 1 })
  })
})

describe('LocalScriptEditRepo：坏 localStorage 不崩、不丢新写入', () => {
  it.each(['null', '[]', '"x"', '{', '{"a":2}'])('坏值 %s → 读空、写新值', (raw) => {
    localStorage.setItem('shadowing.scripts.v1', raw)
    const repo = new LocalScriptEditRepo()
    expect(repo.get('a')).toBeUndefined()
    repo.set('b', 'hello')
    expect(repo.get('b')).toBe('hello')
  })
})
