import type { VocabRepoPort } from '../core/ports'
import type { VocabLibrary } from '../types/document'
import { createLibrary } from '../core/vocab'

const DB_NAME = 'shadowing-vocab'
const DB_VERSION = 1
const STORE = 'library'
const KEY = 'library'
/** 覆盖前把旧值留一份（防「读失败 → 写空库」这类事故；换机器/误删时能救回） */
const PREV_KEY = 'library:prev'

/**
 * 词库持久化（IndexedDB）。
 *
 * 整库当一个记录存：词条是百级、单条几 KB，读写一次就够，
 * 不需要按条建索引。用独立数据库，避免和录音库（`shadowing`）争版本号——
 * IndexedDB 同一个库只能用同一个版本打开，混用会直接 VersionError。
 */
export class IdbVocabRepo implements VocabRepoPort {
  private db: Promise<IDBDatabase> | null = null

  private open(): Promise<IDBDatabase> {
    if (!this.db) {
      this.db = new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, DB_VERSION)
        req.onupgradeneeded = () => {
          if (!req.result.objectStoreNames.contains(STORE)) {
            req.result.createObjectStore(STORE)
          }
        }
        req.onsuccess = () => resolve(req.result)
        req.onerror = () => reject(req.error)
      })
    }
    return this.db
  }

  private async run<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
    const db = await this.open()
    return new Promise<T>((resolve, reject) => {
      const t = db.transaction(STORE, mode)
      const req = fn(t.objectStore(STORE))
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error)
    })
  }

  async load(): Promise<VocabLibrary> {
    const value = await this.run<VocabLibrary | undefined>('readonly', (s) => s.get(KEY))
    return value ?? createLibrary()
  }

  async save(library: VocabLibrary): Promise<void> {
    // 先读了旧值放 backup，再写新的：任何一次覆盖之后都还有「上一版」可退
    try {
      const prev = await this.run<VocabLibrary | undefined>('readonly', (s) => s.get(KEY))
      const backup = await this.run<VocabLibrary | undefined>('readonly', (s) => s.get(PREV_KEY))
      // 只保留「更大」的那一份：词库突然缩水（读失败/误清/事故）时，备份里留住的正是事故前那一版
      if (prev && prev.items.length > 0 && prev.items.length >= (backup?.items.length ?? 0)) {
        await this.run('readwrite', (s) => s.put(prev, PREV_KEY))
      }
    } catch {
      // 备份失败不挡主流程
    }
    await this.run('readwrite', (s) => s.put(library, KEY))
  }

  /** 取「上一版」快照（没有就 null）。 */
  async loadPrev(): Promise<VocabLibrary | null> {
    try {
      return (await this.run<VocabLibrary | undefined>('readonly', (s) => s.get(PREV_KEY))) ?? null
    } catch {
      return null
    }
  }

  async clear(): Promise<void> {
    await this.run('readwrite', (s) => s.delete(KEY))
  }
}

/** 隐私模式 / 老浏览器兜底：内存里，刷新就没。 */
export class MemoryVocabRepo implements VocabRepoPort {
  private library: VocabLibrary = createLibrary()
  private prev: VocabLibrary | null = null
  async load(): Promise<VocabLibrary> {
    return this.library
  }
  async save(library: VocabLibrary): Promise<void> {
    // 同 IDB 实现：备份只变大不缩小（缩水时保住事故前那一版）
    if (this.library.items.length > 0 && this.library.items.length >= (this.prev?.items.length ?? 0)) this.prev = this.library
    this.library = library
  }
  async loadPrev(): Promise<VocabLibrary | null> {
    return this.prev
  }
  async clear(): Promise<void> {
    this.prev = this.library
    this.library = createLibrary()
  }
}

export function createVocabRepo(): VocabRepoPort {
  try {
    if (typeof indexedDB === 'undefined') return new MemoryVocabRepo()
    return new IdbVocabRepo()
  } catch {
    return new MemoryVocabRepo()
  }
}
