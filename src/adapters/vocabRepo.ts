import type { VocabRepoPort, VocabSnapshot } from '../core/ports'
import type { VocabLibrary } from '../types/document'
import { createLibrary } from '../core/vocab'
import { storeHealth, storeRequest } from './storeApi'

const DB_NAME = 'shadowing-vocab'
const DB_VERSION = 1
const STORE = 'library'
const KEY = 'library'
/** 覆盖前把旧值留一份（防「读失败 → 写空库」这类事故；换机器/误删时能救回） */
const PREV_KEY = 'library:prev'
/** 历史快照库（同一 IndexedDB 里另开一个 store：记录单条几 MB 也能接受） */
const SNAP_STORE = 'snapshots'
/** 保留最近多少版（外加「历史最大的一版」永远不淘汰） */
const SNAP_KEEP = 8

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

  /** 往快照库追加一版，并按策略瘦身（留最近 N 版 + 历史最大的一版）。 */
  private async snapshot(library: VocabLibrary, at: string): Promise<void> {
    const db = await this.open()
    await new Promise<void>((resolve, reject) => {
      const t = db.transaction(SNAP_STORE, 'readwrite')
      const s = t.objectStore(SNAP_STORE)
      s.put(library, at)
      t.oncomplete = () => resolve()
      t.onerror = () => reject(t.error)
    })
    // 瘦身：取全部元信息（不读正文）
    const keys = await new Promise<string[]>((resolve) => {
      const t = db.transaction(SNAP_STORE, 'readonly')
      const req = t.objectStore(SNAP_STORE).getAllKeys()
      req.onsuccess = () => resolve((req.result as string[]) ?? [])
      req.onerror = () => resolve([])
    })
    const sorted = [...keys].sort() // 老的在前
    if (sorted.length <= SNAP_KEEP + 1) return
    // 找出「历史最大的一版」所在的 key，永不淘汰
    let largestKey: string | null = null
    let largest = -1
    for (const k of sorted) {
      const v = await new Promise<{ items?: unknown[] } | undefined>((resolve) => {
        const t = db.transaction(SNAP_STORE, 'readonly')
        const req = t.objectStore(SNAP_STORE).get(k)
        req.onsuccess = () => resolve(req.result as { items?: unknown[] } | undefined)
        req.onerror = () => resolve(undefined)
      })
      const n = Array.isArray(v?.items) ? v.items.length : 0
      if (n > largest) {
        largest = n
        largestKey = k
      }
    }
    const keep = new Set(sorted.slice(-SNAP_KEEP))
    if (largestKey) keep.add(largestKey)
    for (const k of sorted) {
      if (keep.has(k)) continue
      await new Promise<void>((resolve) => {
        const t = db.transaction(SNAP_STORE, 'readwrite')
        t.objectStore(SNAP_STORE).delete(k)
        t.oncomplete = () => resolve()
        t.onerror = () => resolve()
      })
    }
  }

  async listSnapshots(): Promise<VocabSnapshot[]> {
    const db = await this.open()
    const rows = await new Promise<{ at: string; count: number }[]>((resolve) => {
      const t = db.transaction(SNAP_STORE, 'readonly')
      const req = t.objectStore(SNAP_STORE).openCursor()
      const out: { at: string; count: number }[] = []
      req.onsuccess = () => {
        const c = req.result
        if (!c) return resolve(out)
        const lib = c.value as { items?: unknown[] }
        out.push({ at: String(c.key), count: Array.isArray(lib?.items) ? lib.items.length : 0 })
        c.continue()
      }
      req.onerror = () => resolve(out)
    })
    return rows.sort((a, b) => b.at.localeCompare(a.at))
  }

  async loadSnapshot(at: string): Promise<VocabLibrary | null> {
    try {
      return (await this.run<VocabLibrary | undefined>('readonly', (s) => s.get(at))) ?? null
    } catch {
      return null
    }
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
    // 再落一版历史快照（多步可退；失败不影响主流程）
    try {
      await this.snapshot(library, new Date().toISOString())
    } catch {
      // 快照失败不挡主流程
    }
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
  private snaps = new Map<string, VocabLibrary>()
  async load(): Promise<VocabLibrary> {
    return this.library
  }
  async save(library: VocabLibrary): Promise<void> {
    // 同 IDB 实现：备份只变大不缩小（缩水时保住事故前那一版）
    if (this.library.items.length > 0 && this.library.items.length >= (this.prev?.items.length ?? 0)) this.prev = this.library
    this.library = library
    this.snaps.set(new Date().toISOString() + ':' + this.snaps.size, library)
  }
  async loadPrev(): Promise<VocabLibrary | null> {
    return this.prev
  }
  async listSnapshots(): Promise<VocabSnapshot[]> {
    return [...this.snaps.entries()]
      .map(([at, lib]) => ({ at, count: lib.items.length }))
      .sort((a, b) => b.at.localeCompare(a.at))
  }
  async loadSnapshot(at: string): Promise<VocabLibrary | null> {
    return this.snaps.get(at) ?? null
  }
  async clear(): Promise<void> {
    this.prev = this.library
    this.library = createLibrary()
  }
}

export function createVocabRepo(): VocabRepoPort {
  return new HybridVocabRepo()
}

function createLocalVocabRepo(): VocabRepoPort {
  try {
    if (typeof indexedDB === 'undefined') return new MemoryVocabRepo()
    return new IdbVocabRepo()
  } catch {
    return new MemoryVocabRepo()
  }
}

type StoreMode = 'unknown' | 'sqlite' | 'local'

/**
 * 词库主存储：本地服务在 → SQLite（`data/xueba.db`）；服务不在 → IndexedDB 兜底。
 *
 * 首次连上 SQLite 且服务端还是空库时，把浏览器里旧的 IndexedDB 词库自动迁上去
 * （`/vocab/if-empty` 在服务端事务里做「空才写」，多标签页同时迁移也不会互相覆盖）。
 * 之后每次写 SQLite 成功，都顺手往 IndexedDB 镜像一份，作为服务挂掉时的本地备份。
 */
export class HybridVocabRepo implements VocabRepoPort {
  private mode: StoreMode = 'unknown'

  constructor(private readonly local: VocabRepoPort = createLocalVocabRepo()) {}

  private async useSqlite(): Promise<boolean> {
    if (this.mode === 'unknown') {
      this.mode = (await storeHealth()) ? 'sqlite' : 'local'
    }
    return this.mode === 'sqlite'
  }

  async load(): Promise<VocabLibrary> {
    if (await this.useSqlite()) {
      try {
        const r = await storeRequest<{ value: VocabLibrary | null }>('/vocab')
        if (r.value) return r.value
        // 服务端还是空库：把浏览器里的旧词库迁上去（首次升级走这里）。
        const local = await this.local.load()
        if (local.items.length > 0) {
          const migrated = await storeRequest<{ migrated: boolean; value: VocabLibrary | null }>(
            '/vocab/if-empty',
            { method: 'PUT', body: JSON.stringify(local) },
          )
          return migrated.value ?? local
        }
        return createLibrary()
      } catch {
        this.mode = 'local'
      }
    }
    return this.local.load()
  }

  async save(library: VocabLibrary): Promise<void> {
    if (await this.useSqlite()) {
      try {
        await storeRequest('/vocab', { method: 'PUT', body: JSON.stringify(library) })
        // 镜像到 IndexedDB：SQLite 文件损坏/服务起不来时还有本机一份。
        void this.local.save(library).catch((e) => console.warn('[词库] 镜像到 IndexedDB 失败', e))
        return
      } catch {
        this.mode = 'local'
      }
    }
    await this.local.save(library)
  }

  async loadPrev(): Promise<VocabLibrary | null> {
    if (await this.useSqlite()) {
      try {
        return (await storeRequest<{ value: VocabLibrary | null }>('/vocab/prev')).value
      } catch {
        this.mode = 'local'
      }
    }
    return (await this.local.loadPrev?.()) ?? null
  }

  async listSnapshots(): Promise<VocabSnapshot[]> {
    if (await this.useSqlite()) {
      try {
        return (await storeRequest<{ snapshots: VocabSnapshot[] }>('/vocab/snapshots')).snapshots
      } catch {
        this.mode = 'local'
      }
    }
    return (await this.local.listSnapshots?.()) ?? []
  }

  async loadSnapshot(at: string): Promise<VocabLibrary | null> {
    if (await this.useSqlite()) {
      try {
        return (
          await storeRequest<{ value: VocabLibrary | null }>(`/vocab/snapshots/${encodeURIComponent(at)}`)
        ).value
      } catch {
        this.mode = 'local'
      }
    }
    return (await this.local.loadSnapshot?.(at)) ?? null
  }

  async clear(): Promise<void> {
    if (await this.useSqlite()) {
      try {
        await storeRequest('/vocab', { method: 'DELETE' })
      } catch {
        this.mode = 'local'
      }
    }
    await this.local.clear()
  }
}
