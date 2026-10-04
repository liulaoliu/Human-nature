import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react'

/**
 * 同步 localStorage 的 useState：首帧从 localStorage 取值，之后每次变更写回。
 *
 * 把项目里到处重复的
 *   const [x, setX] = useState(() => { try { ... } catch {} })
 *   useEffect(() => { try { localStorage.setItem(...) } catch {} }, [x])
 * 收敛成一个 hook。
 *
 * 默认按 JSON 存；简单的字符串/数字/布尔用下面的预设（`persistentString` 等）。
 * 读失败/没有值时用 `initial`。首次挂载不回写（避免用默认值覆盖已有数据）。
 */
export interface PersistentOptions<T> {
  parse?: (raw: string) => T
  serialize?: (value: T) => string
}

export function useLocalStorageState<T>(
  key: string,
  initial: T,
  opts: PersistentOptions<T> = {},
): [T, Dispatch<SetStateAction<T>>] {
  const parse = opts.parse ?? ((raw: string) => JSON.parse(raw) as T)
  const serialize = opts.serialize ?? ((value: T) => JSON.stringify(value))
  // 用 ref 持有 parse/serialize，避免它们每次 render 变身份导致 effect 反复触发
  const parseRef = useRef(parse)
  const serializeRef = useRef(serialize)
  parseRef.current = parse
  serializeRef.current = serialize

  const [state, setState] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(key)
      return raw == null ? initial : parseRef.current(raw)
    } catch {
      return initial
    }
  })

  const first = useRef(true)
  useEffect(() => {
    if (first.current) {
      first.current = false
      return
    }
    try {
      localStorage.setItem(key, serializeRef.current(state))
    } catch {
      // 忽略（隐私模式 / 配额满）
    }
  }, [key, state])

  return [state, setState]
}

/** 字符串原样存。 */
export const persistentString: PersistentOptions<string> = {
  parse: (raw) => raw,
  serialize: (value) => value,
}

/** 布尔存成 '1' / '0'。 */
export const persistentBool: PersistentOptions<boolean> = {
  parse: (raw) => raw === '1',
  serialize: (value) => (value ? '1' : '0'),
}

/** 布尔存成 '1' / '0'，但默认 true（未设置或非 '0' 都算 true）。 */
export const persistentBoolTrue: PersistentOptions<boolean> = {
  parse: (raw) => raw !== '0',
  serialize: (value) => (value ? '1' : '0'),
}

/** 数字存成字符串。 */
export const persistentNumber: PersistentOptions<number> = {
  parse: (raw) => Number(raw),
  serialize: (value) => String(value),
}

/** 从一组候选字符串里取值（非法则用默认）。 */
export function persistentEnum<T extends string>(allowed: readonly T[], fallback: T): PersistentOptions<T> {
  return {
    parse: (raw) => (allowed.includes(raw as T) ? (raw as T) : fallback),
    serialize: (value) => value,
  }
}
