import 'fake-indexeddb/auto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { IdbArticleRepo } from './articleRepo'
import type { SavedArticle } from '../core/ports'

const DB = 'shadowing-reader'

const article = (id: string): SavedArticle => ({
  id,
  title: id,
  text: `text-${id}`,
  paragraphs: [],
  sentences: [],
  sourceKey: null,
  updatedAt: '2026-01-01T00:00:00.000Z',
})

function deleteDb(): Promise<void> {
  return new Promise((resolve) => {
    const req = indexedDB.deleteDatabase(DB)
    req.onsuccess = () => resolve()
    req.onerror = () => resolve()
    req.onblocked = () => resolve()
  })
}

beforeAll(deleteDb)
afterAll(deleteDb)

describe('IdbArticleRepo：文章镜像 + 同步状态', () => {
  it('v1 老库升级到 v2 后文章还在，并能存同步状态', async () => {
    // 手工建一个 v1 库（只有 articles），模拟旧版本留下的镜像。
    await new Promise<void>((resolve, reject) => {
      const req = indexedDB.open(DB, 1)
      req.onupgradeneeded = () => req.result.createObjectStore('articles', { keyPath: 'id' })
      req.onsuccess = () => {
        const db = req.result
        const tx = db.transaction('articles', 'readwrite')
        tx.objectStore('articles').put(article('a1'))
        tx.oncomplete = () => {
          db.close()
          resolve()
        }
        tx.onerror = () => reject(tx.error)
      }
      req.onerror = () => reject(req.error)
    })

    const repo = new IdbArticleRepo()
    expect((await repo.list()).map((a) => a.id)).toEqual(['a1'])

    await repo.setSync({ id: 'a1', pendingUpload: true })
    expect((await repo.getSync('a1'))?.pendingUpload).toBe(true)

    const reopened = new IdbArticleRepo()
    expect((await reopened.getSync('a1'))?.pendingUpload).toBe(true)
    await reopened.removeSync('a1')
    expect(await reopened.getSync('a1')).toBeNull()
  })
})
