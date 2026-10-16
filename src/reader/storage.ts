/**
 * 面板本地状态的**安全读写**。
 *
 * 为什么不让面板直接摸 `localStorage`（架构门禁 R3 会拦）：
 *   1. 隐私模式 / 禁用第三方存储时，`localStorage` 可能直接抛异常，在渲染期抛就把整页打崩；
 *   2. 存进去的东西存的是字符串，读回来忘了判空/JSON.parse 抛错，是数据类事故的常见源头；
 *   3. 键名散落各处，改一次容易漏。
 * 这里把「拿不到就当没有、写不进去就当没写」这一层收口，调用方只管业务。
 *
 * 注意：这里只给**面板局部 UI 状态**用（速读游标、每日计划勾选…）。
 * 词库、文章这类正经数据的持久化在 `adapters/`（IndexedDB），不要往这里塞。
 */

/** 拿得到 localStorage 就用，拿不到（无 DOM / 隐私模式 / 沙箱 iframe）返回 null。 */
function store(): Storage | null {
  try {
    // 有些环境只挂在 window 上（沙箱 iframe / 部分打包器），两处都看一眼
    const g = globalThis as unknown as { localStorage?: Storage; window?: { localStorage?: Storage } }
    const ls = g.localStorage ?? g.window?.localStorage
    if (!ls) return null
    ls.getItem('__probe__') // 某些实现里连 getItem 都会抛
    return ls
  } catch {
    return null
  }
}

export function readRaw(key: string): string | null {
  try {
    return store()?.getItem(key) ?? null
  } catch {
    return null
  }
}

/** 写成功返回 true；没有 storage / 隐私模式 / 配额满返回 false。 */
export function writeRaw(key: string, value: string): boolean {
  const ls = store()
  if (!ls) return false
  try {
    ls.setItem(key, value)
    return true
  } catch {
    return false
  }
}

export function removeRaw(key: string): void {
  try {
    store()?.removeItem(key)
  } catch {
    // 忽略
  }
}

/** 读 JSON；坏数据/没有/解析失败都给 fallback（绝不抛）。 */
export function readJson<T>(key: string, fallback: T): T {
  const raw = readRaw(key)
  if (raw == null) return fallback
  try {
    const value = JSON.parse(raw) as T
    return value == null ? fallback : value
  } catch {
    return fallback
  }
}

export function writeJson(key: string, value: unknown): void {
  try {
    writeRaw(key, JSON.stringify(value))
  } catch {
    // 循环引用之类：不写，别把界面搞崩
  }
}

export function readNum(key: string, fallback = 0): number {
  const raw = readRaw(key)
  if (raw == null) return fallback
  const n = Number.parseInt(raw, 10)
  return Number.isFinite(n) ? n : fallback
}

export function writeNum(key: string, value: number): void {
  writeRaw(key, String(value))
}
