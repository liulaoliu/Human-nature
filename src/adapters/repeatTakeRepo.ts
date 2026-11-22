import type { RepeatTake } from '../core/repeatTake'

const DB_NAME = 'reader-repeat'
const DB_VERSION = 1
const STORE = 'takes'
const ARTICLE_INDEX = 'articleKey'

/**
 * 复读录音的持久化（IndexedDB）。
 *
 * 单开一个库，不和旧的 `shadowing` 混（那边的「音频文件 + 块号」记录已随跟读页下线）：
 * 复读按「文章 + 句子」组织，改正文还要做文本戳校验。
 *
 * 只留每句最新一条，所以 key 就是 `articleKey + sentenceId`（见 `core/repeatTake`），
 * `put` 天然覆盖旧录音。
 */
export class IdbRepeatTakeRepo {
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
          if (!store.indexNames.contains(ARTICLE_INDEX)) {
            store.createIndex(ARTICLE_INDEX, 'articleKey', { unique: false })
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

  async get(id: string): Promise<RepeatTake | undefined> {
    return this.tx<RepeatTake | undefined>('readonly', (s) => s.get(id) as IDBRequest<RepeatTake | undefined>)
  }

  async put(take: RepeatTake): Promise<void> {
    await this.tx('readwrite', (s) => s.put(take))
  }

  async remove(id: string): Promise<void> {
    await this.tx('readwrite', (s) => s.delete(id))
  }

  /** 这一篇的全部录音（孤儿清理用）。 */
  async list(articleKey: string): Promise<RepeatTake[]> {
    return this.tx<RepeatTake[]>(
      'readonly',
      (s) => s.index(ARTICLE_INDEX).getAll(articleKey) as IDBRequest<RepeatTake[]>,
    )
  }

  /** 删掉这一篇里不在 `keep` 中的录音；返回删了几条。 */
  async prune(articleKey: string, keep: Set<string>): Promise<number> {
    const all = await this.list(articleKey)
    const orphans = all.filter((t) => !keep.has(t.id))
    for (const t of orphans) await this.remove(t.id)
    return orphans.length
  }
}

/** 隐私模式 / 没有 IndexedDB：内存里，刷新就没。 */
export class MemoryRepeatTakeRepo {
  private map = new Map<string, RepeatTake>()
  async get(id: string) {
    return this.map.get(id)
  }
  async put(take: RepeatTake) {
    this.map.set(take.id, take)
  }
  async remove(id: string) {
    this.map.delete(id)
  }
  async list(articleKey: string) {
    return [...this.map.values()].filter((t) => t.articleKey === articleKey)
  }
  async prune(articleKey: string, keep: Set<string>) {
    const orphans = (await this.list(articleKey)).filter((t) => !keep.has(t.id))
    for (const t of orphans) this.map.delete(t.id)
    return orphans.length
  }
}

export type RepeatTakeRepo = Pick<IdbRepeatTakeRepo, 'get' | 'put' | 'remove' | 'list' | 'prune'>

export function createRepeatTakeRepo(): RepeatTakeRepo {
  try {
    if (typeof indexedDB === 'undefined') return new MemoryRepeatTakeRepo()
    return new IdbRepeatTakeRepo()
  } catch {
    return new MemoryRepeatTakeRepo()
  }
}
