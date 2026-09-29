import type { Take, TakeRepoPort } from '../core/ports'

const DB_NAME = 'shadowing'
/** 2 = 加上 fileName 索引（1 → 2 是纯增量，老数据不动） */
const DB_VERSION = 2
const STORE = 'takes'
const FILE_INDEX = 'fileName'

/**
 * 录音持久化。切块结果不存——每次打开重跑 VAD 只要 100ms。
 *
 * store 上建了 `fileName` 索引：一次只练一篇，开文件时只取这一篇的录音。
 * 原来用 `getAll()` 再在内存里 filter，多练几篇之后一次开文件就把所有文章的
 * 录音 blob 全搬进内存了（几十 MB）。没有 `fileName` 的老记录不在索引里，
 * 取不出来——和之前的 filter 一样，本来也分不清是哪篇的。
 */
export class IdbTakeRepo implements TakeRepoPort {
  private db: Promise<IDBDatabase> | null = null

  private open(): Promise<IDBDatabase> {
    if (!this.db) {
      this.db = new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, DB_VERSION)
        req.onupgradeneeded = () => {
          const tx = req.transaction
          if (!tx) return
          const store = req.result.objectStoreNames.contains(STORE)
            ? tx.objectStore(STORE)
            : req.result.createObjectStore(STORE, { keyPath: 'id' })
          // 升级老库时补索引；已经是新版就别动
          if (!store.indexNames.contains(FILE_INDEX)) {
            store.createIndex(FILE_INDEX, 'fileName', { unique: false })
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

  /** 只取某一篇的录音（走 fileName 索引） */
  listByFile(fileName: string): Promise<Take[]> {
    return this.tx<Take[]>(
      'readonly',
      (s) => s.index(FILE_INDEX).getAll(fileName) as IDBRequest<Take[]>,
    )
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
  async listByFile(fileName: string) {
    return [...this.map.values()]
      .filter((t) => t.fileName === fileName)
      .sort((a, b) => a.createdAt - b.createdAt)
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
