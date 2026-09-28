import type { Take, TakeRepoPort } from '../core/ports'

const DB_NAME = 'shadowing'
const DB_VERSION = 1
const STORE = 'takes'

/** 录音持久化。切块结果不存——每次打开重跑 VAD 只要 100ms。 */
export class IdbTakeRepo implements TakeRepoPort {
  private db: Promise<IDBDatabase> | null = null

  private open(): Promise<IDBDatabase> {
    if (!this.db) {
      this.db = new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, DB_VERSION)
        req.onupgradeneeded = () => {
          if (!req.result.objectStoreNames.contains(STORE)) {
            req.result.createObjectStore(STORE, { keyPath: 'id' })
          }
        }
        req.onsuccess = () => resolve(req.result)
        req.onerror = () => reject(req.error)
      })
    }
    return this.db
  }

  private async tx<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>) {
    const db = await this.open()
    return new Promise<T>((resolve, reject) => {
      const t = db.transaction(STORE, mode)
      const req = fn(t.objectStore(STORE))
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error)
    })
  }

  private async write(fn: (store: IDBObjectStore) => IDBRequest): Promise<void> {
    await this.tx('readwrite', fn)
  }

  save(take: Take): Promise<void> {
    return this.write((s) => s.put(take))
  }

  list(): Promise<Take[]> {
    return this.tx<Take[]>('readonly', (s) => s.getAll() as IDBRequest<Take[]>)
  }

  remove(id: string): Promise<void> {
    return this.write((s) => s.delete(id))
  }

  clear(): Promise<void> {
    return this.write((s) => s.clear())
  }
}

/** 隐私模式 / 老浏览器兜底：内存里，刷新就没 */
export class MemoryTakeRepo implements TakeRepoPort {
  private map = new Map<string, Take>()
  async save(t: Take) {
    this.map.set(t.id, t)
  }
  async list() {
    return [...this.map.values()].sort((a, b) => a.createdAt - b.createdAt)
  }
  async remove(id: string) {
    this.map.delete(id)
  }
  async clear() {
    this.map.clear()
  }
}

export function createTakeRepo(): TakeRepoPort {
  try {
    if (typeof indexedDB === 'undefined') return new MemoryTakeRepo()
    return new IdbTakeRepo()
  } catch {
    return new MemoryTakeRepo()
  }
}
