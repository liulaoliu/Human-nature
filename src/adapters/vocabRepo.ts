import type { VocabRepoPort, VocabSnapshot } from '../core/ports'
import type { VocabLibrary } from '../types/document'
import { createLibrary } from '../core/vocab'
import { compactSentenceTexts, hydrateSentenceTexts } from '../core/vocab/sentenceTexts'
import { mergeLibrariesForSync, sameLibrary } from '../core/vocab/tombstones'
import { StoreConflictError, storeHealth, storeRequest } from './storeApi'
import { HybridMode } from './hybridMode'

const DB_NAME = 'shadowing-vocab'
/**
 * v1 只建了 `library`，`snapshots` 从来不存在；v2 补建；v3 再补 `meta`（记未同步标记）。
 * 升级必须在 `onupgradeneeded` 里把**所有** store 建齐，不能等到写入时再建。
 */
const DB_VERSION = 3
const STORE = 'library'
const KEY = 'library'
/** 覆盖前把旧值留一份（防「读失败 → 写空库」这类事故；换机器/误删时能救回） */
const PREV_KEY = 'library:prev'
/** 历史快照库（同一 IndexedDB 里另开一个 store：记录单条几 MB 也能接受） */
const SNAP_STORE = 'snapshots'
/** 元数据：只放“本机有未同步改动”这类小标记，不跟词库正文混在一起 */
const META_STORE = 'meta'
const DIRTY_KEY = 'vocab:dirty'
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
          if (!db.objectStoreNames.contains(META_STORE)) db.createObjectStore(META_STORE)
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
    return hydrateSentenceTexts(value ?? createLibrary())
  }

  async markDirty(): Promise<void> {
    await this.run(META_STORE, 'readwrite', (s) => s.put(new Date().toISOString(), DIRTY_KEY))
  }

  async isDirty(): Promise<boolean> {
    try {
      return !!(await this.run<string | undefined>(META_STORE, 'readonly', (s) => s.get(DIRTY_KEY)))
    } catch {
      // 老库升级失败 / 隐私模式：宁可当没脏，也别因此拒绝读服务端
      return false
    }
  }

  async clearDirty(): Promise<void> {
    try {
      await this.run(META_STORE, 'readwrite', (s) => s.delete(DIRTY_KEY))
    } catch {
      // 清标记失败不影响主流程；下次保存成功会再清一次
    }
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
      const value = (await this.run<VocabLibrary | undefined>(SNAP_STORE, 'readonly', (s) => s.get(at))) ?? null
      return value ? hydrateSentenceTexts(value) : null
    } catch {
      return null
    }
  }

  async save(library: VocabLibrary): Promise<void> {
    const next = compactSentenceTexts(library)
    // 先读了旧值放 backup，再写新的：任何一次覆盖之后都还有「上一版」可退
    try {
      const prev = await this.run<VocabLibrary | undefined>(STORE, 'readonly', (s) => s.get(KEY))
      // 上一版 = 刚被覆盖的那一版（和 SQLite 那边同一口径）。旧规则「只留更大的那份」
      // 会让历史最大值永远占着 prev，之后所有缩水事故都退不回去。空库不算上一版。
      if (prev && prev.items.length > 0) {
        await this.run(STORE, 'readwrite', (s) => s.put(compactSentenceTexts(prev), PREV_KEY))
      }
    } catch {
      // 备份失败不挡主流程
    }
    await this.run(STORE, 'readwrite', (s) => s.put(next, KEY))
    // 再落一版历史快照（多步可退；失败不影响主流程）
    try {
      await this.snapshot(next, new Date().toISOString())
    } catch {
      // 快照失败不挡主流程
    }
  }

  /** 取「上一版」快照（没有就 null）。 */
  async loadPrev(): Promise<VocabLibrary | null> {
    try {
      const value = (await this.run<VocabLibrary | undefined>(STORE, 'readonly', (s) => s.get(PREV_KEY))) ?? null
      return value ? hydrateSentenceTexts(value) : null
    } catch {
      return null
    }
  }

  async clear(): Promise<void> {
    await this.run(STORE, 'readwrite', (s) => s.delete(KEY))
    await this.clearDirty()
  }
}

/** 隐私模式 / 老浏览器兜底：内存里，刷新就没。 */
export class MemoryVocabRepo implements VocabRepoPort {
  private library: VocabLibrary = createLibrary()
  private prev: VocabLibrary | null = null
  private snaps = new Map<string, VocabLibrary>()
  private dirty = false
  async load(): Promise<VocabLibrary> {
    return hydrateSentenceTexts(this.library)
  }
  async markDirty(): Promise<void> {
    this.dirty = true
  }
  async isDirty(): Promise<boolean> {
    return this.dirty
  }
  async clearDirty(): Promise<void> {
    this.dirty = false
  }
  async save(library: VocabLibrary): Promise<void> {
    const next = compactSentenceTexts(library)
    // 同 IDB 实现：上一版 = 刚被覆盖的那一版；空库不算上一版
    if (this.library.items.length > 0) this.prev = this.library
    this.library = next
    this.snaps.set(new Date().toISOString() + ':' + this.snaps.size, next)
  }
  async loadPrev(): Promise<VocabLibrary | null> {
    return this.prev ? hydrateSentenceTexts(this.prev) : null
  }
  async listSnapshots(): Promise<VocabSnapshot[]> {
    return [...this.snaps.entries()]
      .map(([at, lib]) => ({ at, count: lib.items.length }))
      .sort((a, b) => b.at.localeCompare(a.at))
  }
  async loadSnapshot(at: string): Promise<VocabLibrary | null> {
    const value = this.snaps.get(at) ?? null
    return value ? hydrateSentenceTexts(value) : null
  }
  async clear(): Promise<void> {
    this.prev = this.library
    this.library = createLibrary()
    this.dirty = false
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
  /** 加载时需要提示用户的一次性消息（例如“本机有未同步改动”）。 */
  private notice: { message: string; needsSave?: boolean } | null = null

  constructor(private readonly local: VocabRepoPort = createLocalVocabRepo()) {}

  takeNotice(): { message: string; needsSave?: boolean } | null {
    const n = this.notice
    this.notice = null
    return n
  }

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

  /**
   * 本机镜像最后一次写入的时间。
   *
   * 优先看历史快照的 key（每次 save 都会写一条，含删除后的空库）；
   * 老库没有快照时退回「词条/按篇记录里最新的时间」。
   * 用来判断离线期间的本地改动是不是比服务端更新 —— 不能只看服务端有值就直接用它。
   */
  private async localSavedAt(local: VocabLibrary): Promise<number> {
    let newest = 0
    try {
      const snaps = await this.local.listSnapshots?.()
      const at = snaps?.[0]?.at
      // Memory 实现的 key 是 `<ISO>:<n>`，取前 24 位；Idb 实现就是纯 ISO。
      if (at) newest = Date.parse(at.slice(0, 24)) || 0
    } catch {
      // 快照读不到就退回词条时间
    }
    if (newest) return newest
    for (const it of local.items) {
      const t = Date.parse(it.updatedAt)
      if (t > newest) newest = t
    }
    for (const e of local.articleEntries ?? []) {
      const t = Date.parse(e.addedAt)
      if (t > newest) newest = t
    }
    return newest
  }

  async load(): Promise<VocabLibrary> {
    if (await this.useSqlite()) {
      try {
        const r = await this.loadServerRevision()
        if (r.value) {
          // 只有「本机确实有未同步改动」才允许本地优先。
          // 不能只看本机镜像写入时间：每次服务端保存成功也会写镜像，时间经常比服务端晚，
          // 会把另一台设备刚写入的词库当成旧版。老实现没有 isDirty 时退回时间比较。
          try {
            const local = await this.local.load()
            const server = hydrateSentenceTexts(r.value)
            if (typeof this.local.isDirty === 'function') {
              if (await this.local.isDirty()) {
                const merged = mergeLibrariesForSync(local, server)
                if (sameLibrary(merged, server)) {
                  // 本机改动已经被服务端覆盖（例如别处更新更晚），清脏即可。
                  try {
                    await this.local.clearDirty?.()
                  } catch {
                    // 清标记失败不影响使用
                  }
                  return server
                }
                this.notice = sameLibrary(merged, local)
                  ? { message: '本机有未同步的词库改动，正在尝试同步到服务端', needsSave: true }
                  : { message: '已合并本机与服务端的词库改动，正在写回服务端', needsSave: true }
                return merged
              }
            } else {
              const localAt = await this.localSavedAt(local)
              const serverAt = r.updatedAt ? Date.parse(r.updatedAt) : 0
              if (localAt > serverAt) {
                this.notice = { message: '本机镜像比服务端新，已优先使用本机；如另一台设备也改过，请先导出备份' }
                return local
              }
            }
          } catch {
            // 本地镜像读失败：退回服务端版本
          }
          return hydrateSentenceTexts(r.value)
        }
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
          try {
            await this.local.clearDirty?.()
          } catch {
            // 清标记失败不影响迁移结果
          }
          return hydrateSentenceTexts(migrated.value ?? local)
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
    // 落盘前把重复的句子原文收进共享表（UI/业务仍然拿 hydrated 的 library）。
    const next = compactSentenceTexts(library)
    if (await this.useSqlite()) {
      try {
        if (!this.revisionKnown) await this.ensureRevisionKnown()
        const r = await storeRequest<{ updatedAt?: string }>(
          '/vocab',
          {
            method: 'PUT',
            body: JSON.stringify(next),
            ...(this.revision ? { headers: { 'X-Vocab-Base': this.revision } } : {}),
          },
          undefined,
          SAVE_TIMEOUT_MS,
        )
        if (r?.updatedAt) this.revision = r.updatedAt
        this.revisionKnown = true
        // 镜像到 IndexedDB：SQLite 文件损坏/服务起不来时还有本机一份。
        // 这次服务端写成功了，清掉之前失败留下的“未同步”标记。
        void this.local
          .save(next)
          .then(async () => {
            try {
              await this.local.clearDirty?.()
            } catch {
              // 清标记失败不影响已成功的服务端保存
            }
          })
          .catch((e) => console.warn('[词库] 镜像到 IndexedDB 失败', e))
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
    // 服务端没写成（或服务没起）：本地这份是**未同步**的，必须置脏；
    // 下次启动只有这种标记才允许本机优先。
    await this.local.save(next)
    try {
      await this.local.markDirty?.()
    } catch {
      // 标记失败不影响本地保存；只是下次可能退回服务端版本
    }
  }

  async loadPrev(): Promise<VocabLibrary | null> {
    if (await this.useSqlite()) {
      try {
        const value = (
          await storeRequest<{ value: VocabLibrary | null }>('/vocab/prev', {}, undefined, READ_TIMEOUT_MS)
        ).value
        return value ? hydrateSentenceTexts(value) : null
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
        const value = (
          await storeRequest<{ value: VocabLibrary | null }>(
            `/vocab/snapshots/${encodeURIComponent(at)}`,
            {},
            undefined,
            READ_TIMEOUT_MS,
          )
        ).value
        return value ? hydrateSentenceTexts(value) : null
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
