import type { ArticleRepoPort, SavedArticle } from '../core/ports'
import { storeHealth, storeRequest } from './storeApi'
import { HybridMode } from './hybridMode'

export type { ArticleRepoPort, SavedArticle } from '../core/ports'

/**
 * 已保存文章持久化（IndexedDB 兜底实现）。
 *
 * 主存现在优先走服务端 SQLite（见 HybridArticleRepo）；没有本地服务 / 静态部署时
 * 仍用这个独立库 `shadowing-reader`，不和录音库、词库争版本号。
 */
const DB_NAME = 'shadowing-reader'
const DB_VERSION = 2
const STORE = 'articles'
const SYNC_STORE = 'article_sync'

/**
 * 本地镜像的同步状态。服务端是主存，但「服务端没有」有两种含义：
 * 离线新建（要上传）和别处已删除（不能复活）。只靠 updatedAt 分不出来。
 */
export interface ArticleSyncMeta {
  id: string
  pendingUpload?: boolean
  pendingDelete?: boolean
}

export interface LocalArticleRepo extends ArticleRepoPort {
  getSync(id: string): Promise<ArticleSyncMeta | null>
  listSync(): Promise<ArticleSyncMeta[]>
  setSync(meta: ArticleSyncMeta): Promise<void>
  removeSync(id: string): Promise<void>
}

export class IdbArticleRepo implements LocalArticleRepo {
  private db: Promise<IDBDatabase> | null = null

  private open(): Promise<IDBDatabase> {
    if (!this.db) {
      this.db = new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, DB_VERSION)
        req.onupgradeneeded = () => {
          if (!req.result.objectStoreNames.contains(STORE)) {
            req.result.createObjectStore(STORE, { keyPath: 'id' })
          }
          if (!req.result.objectStoreNames.contains(SYNC_STORE)) {
            req.result.createObjectStore(SYNC_STORE, { keyPath: 'id' })
          }
        }
        req.onsuccess = () => resolve(req.result)
        req.onerror = () => reject(req.error)
      })
    }
    return this.db
  }

  private async runStore<T>(
    storeName: string,
    mode: IDBTransactionMode,
    fn: (store: IDBObjectStore) => IDBRequest<T>,
  ): Promise<T> {
    const db = await this.open()
    return new Promise<T>((resolve, reject) => {
      const t = db.transaction(storeName, mode)
      const req = fn(t.objectStore(storeName))
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error)
    })
  }

  private run<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
    return this.runStore(STORE, mode, fn)
  }

  async list(): Promise<SavedArticle[]> {
    const all = await this.run<SavedArticle[]>('readonly', (s) => s.getAll() as IDBRequest<SavedArticle[]>)
    return all.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  }

  get(id: string): Promise<SavedArticle | null> {
    return this.run<SavedArticle | undefined>('readonly', (s) => s.get(id)).then((v) => v ?? null)
  }

  async save(article: SavedArticle): Promise<void> {
    // 统一在这里补 createdAt：所有写入方（保存/改名/自动存/导入）都不用自己管，
    // 老数据第一次被重存时也自动补上；已存在的 createdAt 不会被覆盖。
    const prev = article.createdAt ? null : await this.get(article.id)
    const next: SavedArticle = {
      ...article,
      createdAt: article.createdAt ?? prev?.createdAt ?? new Date().toISOString(),
    }
    await this.run('readwrite', (s) => s.put(next))
  }

  async remove(id: string): Promise<void> {
    await this.run('readwrite', (s) => s.delete(id))
  }

  getSync(id: string): Promise<ArticleSyncMeta | null> {
    return this.runStore<ArticleSyncMeta | undefined>(SYNC_STORE, 'readonly', (s) => s.get(id)).then(
      (v) => v ?? null,
    )
  }

  listSync(): Promise<ArticleSyncMeta[]> {
    return this.runStore<ArticleSyncMeta[]>(SYNC_STORE, 'readonly', (s) => s.getAll() as IDBRequest<ArticleSyncMeta[]>)
  }

  setSync(meta: ArticleSyncMeta): Promise<void> {
    return this.runStore(SYNC_STORE, 'readwrite', (s) => s.put(meta)).then(() => undefined)
  }

  removeSync(id: string): Promise<void> {
    return this.runStore(SYNC_STORE, 'readwrite', (s) => s.delete(id)).then(() => undefined)
  }
}

export class MemoryArticleRepo implements LocalArticleRepo {
  private map = new Map<string, SavedArticle>()
  private sync = new Map<string, ArticleSyncMeta>()
  async list() {
    return [...this.map.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  }
  async get(id: string) {
    return this.map.get(id) ?? null
  }
  async save(a: SavedArticle) {
    const prev = this.map.get(a.id)
    this.map.set(a.id, { ...a, createdAt: a.createdAt ?? prev?.createdAt ?? new Date().toISOString() })
  }
  async remove(id: string) {
    this.map.delete(id)
  }
  async getSync(id: string) {
    return this.sync.get(id) ?? null
  }
  async listSync() {
    return [...this.sync.values()]
  }
  async setSync(meta: ArticleSyncMeta) {
    this.sync.set(meta.id, { ...meta })
  }
  async removeSync(id: string) {
    this.sync.delete(id)
  }
}

export function createArticleRepo(): ArticleRepoPort {
  return new HybridArticleRepo()
}

function createLocalArticleRepo(): LocalArticleRepo {
  try {
    if (typeof indexedDB === 'undefined') return new MemoryArticleRepo()
    return new IdbArticleRepo()
  } catch {
    return new MemoryArticleRepo()
  }
}

function sortArticles(list: SavedArticle[]): SavedArticle[] {
  return [...list].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
}

/**
 * 文章主存储：本地服务在 → SQLite；服务不在 → IndexedDB 兜底。
 *
 * 启动时由 `reconcile()` 把 IndexedDB 里「服务端没有 / 更新」的文章补上去；
 * 同一 id 两边都有时，`updatedAt` 更新的那一版优先（离线改过的文章不会被旧库盖掉）。
 * 读写接口本身不再顺手迁移 —— 读就是读。每次写 SQLite 成功都往 IndexedDB 镜像一份。
 * 模式选择与重试见 `HybridMode`。
 */
export class HybridArticleRepo implements ArticleRepoPort {
  private readonly hybrid = new HybridMode(() => storeHealth())

  constructor(private readonly local: LocalArticleRepo = createLocalArticleRepo()) {}

  private useSqlite(): Promise<boolean> {
    return this.hybrid.useSqlite()
  }

  private markSynced(id: string): Promise<void> {
    return this.local.setSync({ id })
  }

  private markPendingUpload(id: string): Promise<void> {
    return this.local.setSync({ id, pendingUpload: true })
  }

  private markPendingDelete(id: string): Promise<void> {
    return this.local.setSync({ id, pendingDelete: true })
  }

  /**
   * 同步本地镜像与服务端（只在启动时调用一次）。
   *
   * 关键：本地镜像 ≠ 离线新建。只有 `pendingUpload`（或升级前没有同步记录的老镜像）
   * 才允许上传；已同步镜像在服务端消失表示别处删除，必须清掉，不能重新 PUT 复活。
   */
  async reconcile(): Promise<void> {
    if (!(await this.useSqlite())) return
    try {
      const r = await storeRequest<{ articles: SavedArticle[] }>('/articles')
      const serverById = new Map(r.articles.map((a) => [a.id, a]))
      const localAll = await this.local.list()
      const localById = new Map(localAll.map((a) => [a.id, a]))
      const syncById = new Map((await this.local.listSync()).map((m) => [m.id, m]))
      const removed = new Set<string>()

      // 先重试别处/离线删除留下的墓碑；失败就留着，本次不复活文章。
      for (const meta of [...syncById.values()]) {
        if (!meta.pendingDelete) continue
        try {
          await storeRequest(`/articles/${encodeURIComponent(meta.id)}`, { method: 'DELETE' })
          removed.add(meta.id)
          serverById.delete(meta.id)
          localById.delete(meta.id)
          syncById.delete(meta.id)
          await this.local.remove(meta.id)
          await this.local.removeSync(meta.id)
        } catch {
          this.hybrid.fail()
        }
      }

      // 服务端有、本地没有：补一份镜像，之后 get/list 可以离线兜底。
      for (const [id, article] of serverById) {
        if (localById.has(id)) continue
        await this.local.save(article)
        await this.markSynced(id)
      }

      for (const local of localAll) {
        if (removed.has(local.id)) continue
        const server = serverById.get(local.id)
        const meta = syncById.get(local.id)
        // 删除失败的墓碑不能因为服务端还在就当成已同步。
        if (meta?.pendingDelete) continue
        const pendingUpload = !meta || meta.pendingUpload === true

        if (!server) {
          if (pendingUpload) {
            await storeRequest(`/articles/${encodeURIComponent(local.id)}`, {
              method: 'PUT',
              body: JSON.stringify(local),
            })
            await this.markSynced(local.id)
          } else {
            // 已同步镜像 + 服务端没有 = 别处删除；删本地，绝不 PUT。
            await this.local.remove(local.id)
            await this.local.removeSync(local.id)
          }
          continue
        }

        if (local.updatedAt > server.updatedAt) {
          await storeRequest(`/articles/${encodeURIComponent(local.id)}`, {
            method: 'PUT',
            body: JSON.stringify(local),
          })
          await this.markSynced(local.id)
        } else {
          if (server.updatedAt > local.updatedAt) await this.local.save(server)
          await this.markSynced(local.id)
        }
      }
    } catch {
      // 迁移失败不阻塞阅读：list() 仍会把本地较新的版本合并进来。
      this.hybrid.fail()
    }
  }

  async list(): Promise<SavedArticle[]> {
    if (await this.useSqlite()) {
      try {
        const r = await storeRequest<{ articles: SavedArticle[] }>('/articles')
        const byId = new Map(r.articles.map((a) => [a.id, a]))
        const syncById = new Map((await this.local.listSync()).map((m) => [m.id, m]))
        // 删除失败/离线留下的墓碑：服务端还没删掉，也不能先放回列表。
        for (const [id, meta] of syncById) if (meta.pendingDelete) byId.delete(id)
        // 只读合并：本地更新的一版直接显示；已同步但服务端没有的镜像不再复活。
        for (const local of await this.local.list()) {
          const meta = syncById.get(local.id)
          if (meta?.pendingDelete) continue
          const server = byId.get(local.id)
          if (server) {
            if (local.updatedAt > server.updatedAt) byId.set(local.id, local)
          } else if (!meta || meta.pendingUpload) {
            byId.set(local.id, local)
          }
        }
        return sortArticles([...byId.values()])
      } catch {
        this.hybrid.fail()
      }
    }
    return this.local.list()
  }

  async get(id: string): Promise<SavedArticle | null> {
    const local = await this.local.get(id)
    const meta = await this.local.getSync(id)
    if (meta?.pendingDelete) return null
    if (await this.useSqlite()) {
      try {
        const r = await storeRequest<{ value: SavedArticle | null }>(`/articles/${encodeURIComponent(id)}`)
        if (r.value) {
          // 和 list()/reconcile() 同一口径：本地更新的一版优先。
          return local && local.updatedAt > r.value.updatedAt ? local : r.value
        }
        if (local && (!meta || meta.pendingUpload)) return local
        // 已同步镜像 + 服务端没有 = 别处删除；清掉，别让旧正文复活。
        if (local) {
          await this.local.remove(id)
          await this.local.removeSync(id)
        }
        return null
      } catch {
        this.hybrid.fail()
      }
    }
    return local
  }

  async save(article: SavedArticle): Promise<void> {
    if (await this.useSqlite()) {
      try {
        await storeRequest(`/articles/${encodeURIComponent(article.id)}`, {
          method: 'PUT',
          body: JSON.stringify(article),
        })
        try {
          await this.local.save(article)
          await this.markSynced(article.id)
        } catch (e) {
          console.warn('[文章] 镜像到 IndexedDB 失败', e)
        }
        return
      } catch {
        this.hybrid.fail()
      }
    }
    await this.local.save(article)
    await this.markPendingUpload(article.id)
  }

  async remove(id: string): Promise<void> {
    if (await this.useSqlite()) {
      try {
        await storeRequest(`/articles/${encodeURIComponent(id)}`, { method: 'DELETE' })
        await this.local.remove(id)
        await this.local.removeSync(id)
        return
      } catch {
        this.hybrid.fail()
      }
    }
    // 删除失败/离线：本地先删，但留墓碑；reconcile 恢复后重试 DELETE，避免文章再冒出来。
    await this.local.remove(id)
    await this.markPendingDelete(id)
  }
}
