import type { Paragraph, Sentence } from '../types/document'

/**
 * 已保存的文章持久化（IndexedDB）。
 *
 * 为什么要存整篇（而不是只存原文、每次重新切句）：
 * 粘回来的翻译/语法/搭配是挂在句子上的，重新切句会丢。所以连 paragraphs /
 * sentences 一起存，下次打开是你上次离开时的样子。
 *
 * 用独立库 `shadowing-reader`，不和录音库、词库争版本号。
 */
export interface SavedArticle {
  id: string
  title: string
  /** 对应 articles.json 的键；手动粘贴的为 null */
  sourceKey: string | null
  /** 清洗后的正文；编辑模式与重新切句用 */
  text: string
  paragraphs: Paragraph[]
  sentences: Sentence[]
  updatedAt: string
}

export interface ArticleRepoPort {
  list(): Promise<SavedArticle[]>
  get(id: string): Promise<SavedArticle | null>
  save(article: SavedArticle): Promise<void>
  remove(id: string): Promise<void>
}

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
    await this.run('readwrite', (s) => s.put(article))
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
    this.map.set(a.id, a)
  }
  async remove(id: string) {
    this.map.delete(id)
  }
}

export function createArticleRepo(): ArticleRepoPort {
  try {
    if (typeof indexedDB === 'undefined') return new MemoryArticleRepo()
    return new IdbArticleRepo()
  } catch {
    return new MemoryArticleRepo()
  }
}
