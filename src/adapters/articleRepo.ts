import type { ArticleRepoPort, SavedArticle } from '../core/ports'
import { storeHealth, storeRequest } from './storeApi'

export type { ArticleRepoPort, SavedArticle } from '../core/ports'

/**
 * 已保存文章持久化（IndexedDB 兜底实现）。
 *
 * 主存现在优先走服务端 SQLite（见 HybridArticleRepo）；没有本地服务 / 静态部署时
 * 仍用这个独立库 `shadowing-reader`，不和录音库、词库争版本号。
 */
const DB_NAME = 'shadowing-reader'
const DB_VERSION = 1
const STORE = 'articles'

export class IdbArticleRepo implements ArticleRepoPort {
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

  private async run<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
    const db = await this.open()
    return new Promise<T>((resolve, reject) => {
      const t = db.transaction(STORE, mode)
      const req = fn(t.objectStore(STORE))
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error)
    })
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
}

export class MemoryArticleRepo implements ArticleRepoPort {
  private map = new Map<string, SavedArticle>()
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
}

export function createArticleRepo(): ArticleRepoPort {
  return new HybridArticleRepo()
}

function createLocalArticleRepo(): ArticleRepoPort {
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

type StoreMode = 'unknown' | 'sqlite' | 'local'

/**
 * 文章主存储：本地服务在 → SQLite；服务不在 → IndexedDB 兜底。
 *
 * 首次连上时把 IndexedDB 里有、SQLite 里没有的文章补上去；
 * 同一 id 两边都有时，`updatedAt` 更新的那一版优先（离线改过的文章不会被旧库盖掉）。
 * 每次写 SQLite 成功都往 IndexedDB 镜像一份，作为服务挂掉时的本地备份。
 */
export class HybridArticleRepo implements ArticleRepoPort {
  private mode: StoreMode = 'unknown'

  constructor(private readonly local: ArticleRepoPort = createLocalArticleRepo()) {}

  private async useSqlite(): Promise<boolean> {
    if (this.mode === 'unknown') {
      this.mode = (await storeHealth()) ? 'sqlite' : 'local'
    }
    return this.mode === 'sqlite'
  }

  async list(): Promise<SavedArticle[]> {
    if (await this.useSqlite()) {
      try {
        const r = await storeRequest<{ articles: SavedArticle[] }>('/articles')
        const byId = new Map(r.articles.map((a) => [a.id, a]))
        for (const local of await this.local.list()) {
          const server = byId.get(local.id)
          if (!server || (local.updatedAt && local.updatedAt > server.updatedAt)) {
            await storeRequest(`/articles/${encodeURIComponent(local.id)}`, {
              method: 'PUT',
              body: JSON.stringify(local),
            })
            byId.set(local.id, local)
          }
        }
        return sortArticles([...byId.values()])
      } catch {
        this.mode = 'local'
      }
    }
    return this.local.list()
  }

  async get(id: string): Promise<SavedArticle | null> {
    if (await this.useSqlite()) {
      try {
        const r = await storeRequest<{ value: SavedArticle | null }>(`/articles/${encodeURIComponent(id)}`)
        if (r.value) return r.value
        const local = await this.local.get(id)
        if (local) {
          await storeRequest(`/articles/${encodeURIComponent(id)}`, {
            method: 'PUT',
            body: JSON.stringify(local),
          })
          return local
        }
        return null
      } catch {
        this.mode = 'local'
      }
    }
    return this.local.get(id)
  }

  async save(article: SavedArticle): Promise<void> {
    if (await this.useSqlite()) {
      try {
        await storeRequest(`/articles/${encodeURIComponent(article.id)}`, {
          method: 'PUT',
          body: JSON.stringify(article),
        })
        void this.local.save(article).catch(() => {})
        return
      } catch {
        this.mode = 'local'
      }
    }
    await this.local.save(article)
  }

  async remove(id: string): Promise<void> {
    if (await this.useSqlite()) {
      try {
        await storeRequest(`/articles/${encodeURIComponent(id)}`, { method: 'DELETE' })
      } catch {
        this.mode = 'local'
      }
    }
    await this.local.remove(id)
  }
}
