// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { makeBackup } from '../core/stateBackup'
import {
  applyLocalState,
  collectLocalState,
  currentBackup,
  loadProjectSeed,
  localStateIsEmpty,
  saveToProject,
} from './stateBackup'

// adapters 不许依赖 reader（R2），这里内联一个假 localStorage
function installFakeStorage(): () => void {
  const map = new Map<string, string>()
  const storage = {
    get length() {
      return map.size
    },
    clear: () => map.clear(),
    getItem: (k: string) => map.get(k) ?? null,
    key: (i: number) => [...map.keys()][i] ?? null,
    removeItem: (k: string) => void map.delete(k),
    setItem: (k: string, v: string) => void map.set(k, String(v)),
  } as Storage
  const desc = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
  Object.defineProperty(globalThis, 'localStorage', { value: storage, configurable: true, writable: true })
  return () => {
    if (desc) Object.defineProperty(globalThis, 'localStorage', desc)
    else Object.defineProperty(globalThis, 'localStorage', { value: undefined, configurable: true, writable: true })
  }
}

let restore: () => void = () => {}

beforeEach(() => {
  restore = installFakeStorage()
})

afterEach(() => {
  restore()
  vi.restoreAllMocks()
})

describe('stateBackup：localStorage 收集与覆盖', () => {
  it('只碰 shadowing. 前缀；其他键原样不动', () => {
    localStorage.setItem('shadowing.voice', 'aria')
    localStorage.setItem('shadowing.settings', '{"a":1}')
    localStorage.setItem('reader:last', 'x')

    expect(collectLocalState()).toEqual({
      'shadowing.voice': 'aria',
      'shadowing.settings': '{"a":1}',
    })
    expect(localStateIsEmpty()).toBe(false)

    const n = applyLocalState({ 'shadowing.voice': 'sonia', 'reader:last': 'hacked' })
    expect(n).toBe(1)
    expect(localStorage.getItem('shadowing.voice')).toBe('sonia')
    expect(localStorage.getItem('reader:last')).toBe('x')
  })

  it('空存储时为空；currentBackup 带全部我们自己的键', () => {
    expect(localStateIsEmpty()).toBe(true)
    localStorage.setItem('shadowing.voice', 'aria')
    const b = currentBackup()
    expect(b.app).toBe('shadowing')
    expect(b.data).toEqual({ 'shadowing.voice': 'aria' })
    expect(typeof b.exportedAt).toBe('number')
  })
})

describe('stateBackup：项目文件', () => {
  it('saveToProject 成功 true / 网络异常 false', async () => {
    const backup = makeBackup({ 'shadowing.a': '1' })
    const f = vi.fn().mockResolvedValue({ ok: true })
    vi.stubGlobal('fetch', f)
    await expect(saveToProject(backup)).resolves.toBe(true)
    expect(f).toHaveBeenCalledWith('/__state', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(backup),
    })

    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('down')))
    await expect(saveToProject(backup)).resolves.toBe(false)
    vi.unstubAllGlobals()
  })

  it('loadProjectSeed：合法备份解析；坏 JSON / 非 2xx / 网络异常都 null', async () => {
    const backup = makeBackup({ 'shadowing.a': '1' })
    const f = vi.fn().mockResolvedValue({ ok: true, text: async () => JSON.stringify(backup) })
    vi.stubGlobal('fetch', f)
    await expect(loadProjectSeed()).resolves.toEqual(backup)
    expect(f).toHaveBeenCalledWith('shadowing-state.json', { cache: 'no-store' })

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, text: async () => '{oops' }))
    await expect(loadProjectSeed()).resolves.toBeNull()

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, text: async () => '' }))
    await expect(loadProjectSeed()).resolves.toBeNull()

    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')))
    await expect(loadProjectSeed()).resolves.toBeNull()
    vi.unstubAllGlobals()
  })
})
