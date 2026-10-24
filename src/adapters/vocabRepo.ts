import type { VocabRepoPort, VocabSnapshot } from '../core/ports'
import type { VocabLibrary } from '../types/document'
import { createLibrary } from '../core/vocab'
import { StoreConflictError, storeHealth, storeRequest } from './storeApi'
import { HybridMode } from './hybridMode'

const DB_NAME = 'shadowing-vocab'
/**
 * v1 只建了 `library`，`snapshots` 从来不存在；v2 补建。
 * 升级必须在 `onupgradeneeded` 里同时建两个 store，不能等到写入时再建。
 */
const DB_VERSION = 2
const STORE = 'library'
const KEY = 'library'
/** 覆盖前把旧值留一份（防「读失败 → 写空库」这类事故；换机器/误删时能救回） */
const PREV_KEY = 'library:prev'
/** 历史快照库（同一 IndexedDB 里另开一个 store：记录单条几 MB 也能接受） */
const SNAP_STORE = 'snapshots'
/** 保留最近多少版（外加「历史最大的一版」永远不淘汰） */
const SNAP_KEEP = 5

/**
 * 词库持久化（IndexedDB）。
 *
 * 整库当一个记录存：词条是百级、单条几 KB，读写一次就够，
 * 不需要按条建索引。用独立数据库，避免和录音库（`shadowing`）争版本号——
 * IndexedDB 同一个库只能用同一个版本打开，混用会直接 VersionError。
 */
export class IdbVocabRepo implements VocabRepoPort {
  private db: Promise<IDBDatabase> | null = null

  constructor(private readonly dbName: string = DB_NAME) {}

  private open(): Promise<IDBDatabase> {
    if (!this.db) {
      this.db = new Promise((resolve, reject) => {
        const req = indexedDB.open(this.dbName, DB_VERSION)
        req.onupgradeneeded = () => {
          const db = req.result
          if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE)
          if (!db.objectStoreNames.contains(SNAP_STORE)) db.createObjectStore(SNAP_STORE)
        }
        req.onsuccess = () => resolve(req.result)
        req.onerror = () => {
          this.db = null
          reject(req.error)
        }
        // 另一个标签页还开着旧版本会卡在 blocked；不能让它永远 pending
        req.onblocked = () => {
          this.db = null
          reject(new Error('IndexedDB 升级被其它标签页占用，请关掉旧页面再试'))
        }
      })
    }
    return this.db
  }

  /**
   * 在指定 store 上跑一次请求。
   *
   * 写事务要等 `oncomplete` 才算落盘（request 的 success 早于事务提交）；
   * 只等 request 会在页面立刻关闭时丢掉最后一批快照。
   */
  private async run<T>(
    storeName: string,
    mode: IDBTransactionMode,
    fn: (store: IDBObjectStore) => IDBRequest<T>,
  ): Promise<T> {
    const db = await this.open()
    return new Promise<T>((resolve, reject) => {
      let t: IDBTransaction
      try {
        t = db.transaction(storeName, mode)
      } catch (e) {
        reject(e)
        return
      }
      let result: T
      const req = fn(t.objectStore(storeName))
      req.onsuccess = () => {
        result = req.result
        if (mode === 'readonly') resolve(result)
      }
      req.onerror = () => reject(req.error)
      t.onabort = () => reject(t.error ?? new Error('IndexedDB 事务中止'))
      if (mode !== 'readonly') {
        t.oncomplete = () => resolve(result)
      }
    })
  }

  async load(): Promise<VocabLibrary> {
    const value = await this.run<VocabLibrary | undefined>(STORE, 'readonly', (s) => s.get(KEY))
    return value ?? createLibrary()
  }

  /** 往快照库追加一版，并按策略瘦身（留最近 N 版 + 历史最大的一版）。 */
  private async snapshot(library: VocabLibrary, at: string): Promise<void> {
    const db = await this.open()
    await this.run(SNAP_STORE, 'readwrite', (s) => s.put(library, at))
    // 瘦身：取全部 key（不读正文）
    let keys: string[] = []
    try {
      keys = await this.run<string[]>(SNAP_STORE, 'readonly', (s) => s.getAllKeys() as IDBRequest<string[]>)
    } catch {
      // 快照清理失败不影响主流程
      return
    }
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
      let t: IDBTransaction
      try {
        t = db.transaction(SNAP_STORE, 'readonly')
      } catch {
        resolve([])
        return
      }
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
      t.onabort = () => resolve(out)
    })
    return rows.sort((a, b) => b.at.localeCompare(a.at))
  }

  async loadSnapshot(at: string): Promise<VocabLibrary | null> {
    try {
      return (await this.run<VocabLibrary | undefined>(SNAP_STORE, 'readonly', (s) => s.get(at))) ?? null
    } catch {
      return null
    }
  }

  async save(library: VocabLibrary): Promise<void> {
    // 先读了旧值放 backup，再写新的：任何一次覆盖之后都还有「上一版」可退
    try {
      const prev = await this.run<VocabLibrary | undefined>(STORE, 'readonly', (s) => s.get(KEY))
      // 上一版 = 刚被覆盖的那一版（和 SQLite 那边同一口径）。旧规则「只留更大的那份」
      // 会让历史最大值永远占着 prev，之后所有缩水事故都退不回去。空库不算上一版。
      if (prev && prev.items.length > 0) {
        await this.run(STORE, 'readwrite', (s) => s.put(prev, PREV_KEY))
      }
    } catch {
      // 备份失败不挡主流程
    }
    await this.run(STORE, 'readwrite', (s) => s.put(library, KEY))
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
      return (await this.run<VocabLibrary | undefined>(STORE, 'readonly', (s) => s.get(PREV_KEY))) ?? null
    } catch {
      return null
    }
  }

  async clear(): Promise<void> {
    await this.run(STORE, 'readwrite', (s) => s.delete(KEY))
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
    // 同 IDB 实现：上一版 = 刚被覆盖的那一版；空库不算上一版
    if (this.library.items.length > 0) this.prev = this.library
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

/**
 * 词库主存储：本地服务在 → SQLite（`data/xueba.db`）；服务不在 → IndexedDB 兜底。
 *
 * 首次连上 SQLite 且服务端还是空库时，把浏览器里旧的 IndexedDB 词库自动迁上去
 * （`/vocab/if-empty` 在服务端事务里做「空才写」，多标签页同时迁移也不会互相覆盖）。
 * 之后每次写 SQLite 成功，都顺手往 IndexedDB 镜像一份，作为服务挂掉时的本地备份。
 *
 * 模式选择与重试见 `HybridMode`：服务恢复后会自动切回 SQLite，不会整个会话锁死在本地。
 */
/** 词库 PUT 可能传 16MB，给足时间，但绝不能无限挂住合并写队列。 */
const SAVE_TIMEOUT_MS = 12_000
/** 读词库 / 恢复版本：同样要有上限，否则启动或恢复会一直转圈。 */
const READ_TIMEOUT_MS = 8_000

export class HybridVocabRepo implements VocabRepoPort {
  private readonly hybrid = new HybridMode(() => storeHealth())
  /**
   * 服务端那一版的 `updatedAt`：本页读到/写成功时记下，写回时作乐观锁的 base 送过去。
   * 旧标签页的 ref 停在它自己读到的那一版，所以它的保存会被 409 挡掉，而不是把别处的改动抹平。
   */
  private revision: string | null = null
  /**
   * `revision` 是否可信。
   *
   * 读失败时不能继续用 `revision = null` 去 PUT —— 服务端会把它当成「没有 base，强制覆盖」，
   * 于是本地旧镜像把别的页面/别的设备刚写的词库抹掉。未知时先补一次 GET：
   * 服务端空库才允许写，已有数据就按冲突处理，让用户刷新。
   */
  private revisionKnown = false

  constructor(private readonly local: VocabRepoPort = createLocalVocabRepo()) {}

  private useSqlite(): Promise<boolean> {
    return this.hybrid.useSqlite()
  }

  private async loadServerRevision(): Promise<{ value: VocabLibrary | null; updatedAt: string | null }> {
    const r = await storeRequest<{ value: VocabLibrary | null; updatedAt?: string | null }>(
      '/vocab',
      {},
      undefined,
      READ_TIMEOUT_MS,
    )
    this.revision = r.updatedAt ?? null
    this.revisionKnown = true
    return { value: r.value, updatedAt: this.revision }
  }

  async load(): Promise<VocabLibrary> {
    if (await this.useSqlite()) {
      try {
        const r = await this.loadServerRevision()
        if (r.value) return r.value
        // 服务端还是空库：把浏览器里的旧词库迁上去（首次升级走这里）。
        const local = await this.local.load()
        if (local.items.length > 0) {
          const migrated = await storeRequest<{
            migrated: boolean
            value: VocabLibrary | null
            updatedAt?: string | null
          }>('/vocab/if-empty', { method: 'PUT', body: JSON.stringify(local) }, undefined, SAVE_TIMEOUT_MS)
          this.revision = migrated.updatedAt ?? null
          this.revisionKnown = true
          return migrated.value ?? local
        }
        return createLibrary()
      } catch {
        this.revisionKnown = false
        this.hybrid.fail()
      }
    }
    return this.local.load()
  }

  /**
   * 读失败后第一次写之前补版本号。
   *
   * 服务端已有数据时**不能**拿本地旧镜像直接覆盖（那正是 P1-3 的事故）；
   * 抛冲突让上层提示刷新。只有服务端确实为空才允许写。
   */
  private async ensureRevisionKnown(): Promise<void> {
    const { value } = await this.loadServerRevision()
    if (value && value.items.length > 0) {
      throw new StoreConflictError('词库读取失败后服务端已有数据，请刷新后再改', {
        updatedAt: this.revision,
        count: value.items.length,
      })
    }
  }

  async save(library: VocabLibrary): Promise<void> {
    if (await this.useSqlite()) {
      try {
        if (!this.revisionKnown) await this.ensureRevisionKnown()
        const r = await storeRequest<{ updatedAt?: string }>(
          '/vocab',
          {
            method: 'PUT',
            body: JSON.stringify(library),
            ...(this.revision ? { headers: { 'X-Vocab-Base': this.revision } } : {}),
          },
          undefined,
          SAVE_TIMEOUT_MS,
        )
        if (r?.updatedAt) this.revision = r.updatedAt
        this.revisionKnown = true
        // 镜像到 IndexedDB：SQLite 文件损坏/服务起不来时还有本机一份。
        void this.local.save(library).catch((e) => console.warn('[词库] 镜像到 IndexedDB 失败', e))
        return
      } catch (e) {
        if (e instanceof StoreConflictError) {
          // 别的地方先写了一版。**不能**当成"服务挂了"降级到 IndexedDB（那才是真丢数据），
          // 也不能悄悄重试——先把服务器版本记下来（用户若坚持再存一次会覆盖，另有 prev/快照兜底），
          // 把冲突抛上去让界面明确告诉他发生了什么。
          this.revision = e.updatedAt
          this.revisionKnown = true
          throw e
        }
        this.revisionKnown = false
        this.hybrid.fail()
      }
    }
    await this.local.save(library)
  }

  async loadPrev(): Promise<VocabLibrary | null> {
    if (await this.useSqlite()) {
      try {
        return (
          await storeRequest<{ value: VocabLibrary | null }>('/vocab/prev', {}, undefined, READ_TIMEOUT_MS)
        ).value
      } catch {
        this.hybrid.fail()
      }
    }
    return (await this.local.loadPrev?.()) ?? null
  }

  async listSnapshots(): Promise<VocabSnapshot[]> {
    if (await this.useSqlite()) {
      try {
        return (
          await storeRequest<{ snapshots: VocabSnapshot[] }>('/vocab/snapshots', {}, undefined, READ_TIMEOUT_MS)
        ).snapshots
      } catch {
        this.hybrid.fail()
      }
    }
    return (await this.local.listSnapshots?.()) ?? []
  }

  async loadSnapshot(at: string): Promise<VocabLibrary | null> {
    if (await this.useSqlite()) {
      try {
        return (
          await storeRequest<{ value: VocabLibrary | null }>(
            `/vocab/snapshots/${encodeURIComponent(at)}`,
            {},
            undefined,
            READ_TIMEOUT_MS,
          )
        ).value
      } catch {
        this.hybrid.fail()
      }
    }
    return (await this.local.loadSnapshot?.(at)) ?? null
  }

  async clear(): Promise<void> {
    if (await this.useSqlite()) {
      try {
        await storeRequest('/vocab', { method: 'DELETE' }, undefined, SAVE_TIMEOUT_MS)
        // 服务器上已经没有词库了，下次写入不该再拿旧版本号去对
        this.revision = null
        this.revisionKnown = true
      } catch {
        this.revisionKnown = false
        this.hybrid.fail()
      }
    }
    await this.local.clear()
  }
}
