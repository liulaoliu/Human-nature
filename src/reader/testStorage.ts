/**
 * 测试用：给当前环境装一个**假的 localStorage**（测试专用，不进生产包）。
 *
 * 为什么要它：跑在 jsdom 里时，jsdom 的 `localStorage` 取不到（不透明来源会被 vitest 跳过），
 * 而 Node 26 自带一个只读的全局 `localStorage` —— 直接赋值会静默失败。
 * 所以统一用 defineProperty 覆盖，测完还原。
 */
export interface FakeStorageOptions {
  getItem?: (key: string) => string | null
  setItem?: (key: string, value: string) => void
}

export function makeFakeStorage(opts: FakeStorageOptions = {}): Storage {
  const map = new Map<string, string>()
  return {
    get length() {
      return map.size
    },
    clear: () => map.clear(),
    getItem: (k: string) => (opts.getItem ? opts.getItem(k) : map.get(k) ?? null),
    key: (i: number) => [...map.keys()][i] ?? null,
    removeItem: (k: string) => void map.delete(k),
    setItem: (k: string, v: string) => {
      if (opts.setItem) opts.setItem(k, v)
      else map.set(k, String(v))
    },
  } as Storage
}

/** 装上假 storage，返回「还原」函数（记得在 afterEach 里调）。 */
export function installFakeStorage(storage: Storage = makeFakeStorage()): () => void {
  const desc = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
  Object.defineProperty(globalThis, 'localStorage', { value: storage, configurable: true, writable: true })
  return () => {
    if (desc) Object.defineProperty(globalThis, 'localStorage', desc)
    else Object.defineProperty(globalThis, 'localStorage', { value: undefined, configurable: true, writable: true })
  }
}
