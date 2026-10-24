// @vitest-environment node
import 'fake-indexeddb/auto'
import { afterEach, describe, expect, it } from 'vitest'
import { IdbVocabRepo } from './vocabRepo'
import { createLibrary } from '../core/vocab'
import { vocabItem } from '../core/testFixtures'

/**
 * IndexedDB 快照库的真实读写。
 *
 * 事故背景（P2-5）：v1 只在升级时建了 `library`，`snapshots` store 根本不存在；
 * `snapshot()` 里 `db.transaction('snapshots')` 同步抛 NotFoundError，被 save 的
 * try/catch 吞掉 —— 快照功能从来没工作过。`loadSnapshot()` 还走错 store，
 * 从 `library` 里按时间戳取，永远 null。
 *
 * 这里用 fake-indexeddb 真开库，覆盖：
 *   1. 新库同时建两个 store，save 后能列出/读回快照；
 *   2. 从 v1（只有 library）升级到 v2 时补建 snapshots，旧词库不丢。
 */

const lib = (n: number) => ({
  ...createLibrary(),
  items: Array.from({ length: n }, (_, i) => vocabItem({ id: `w${i}`, word: `w${i}`, lemma: `w${i}` })),
})

const names: string[] = []
function dbName(): string {
  const name = `test-vocab-${Math.random().toString(36).slice(2)}`
  names.push(name)
  return name
}

function deleteDb(name: string): Promise<void> {
  return new Promise((resolve) => {
    const req = indexedDB.deleteDatabase(name)
    req.onsuccess = () => resolve()
    req.onerror = () => resolve()
    req.onblocked = () => resolve()
  })
}

afterEach(async () => {
  await Promise.all(names.splice(0).map(deleteDb))
})

describe('IdbVocabRepo：快照库', () => {
  it('新库同时建 library 与 snapshots，保存后能列出并读回快照', async () => {
    const repo = new IdbVocabRepo(dbName())
    await repo.save(lib(3))

    const snapshots = await repo.listSnapshots()
    expect(snapshots).toHaveLength(1)
    expect(snapshots[0].count).toBe(3)

    const back = await repo.loadSnapshot(snapshots[0].at)
    expect(back?.items).toHaveLength(3)
    expect(back?.items[0].word).toBe('w0')
  })

  it('从 v1 旧库升级：补建 snapshots，旧词库还在', async () => {
    const name = dbName()
    // 模拟线上旧库：version 1，只有 library store
    await new Promise<void>((resolve, reject) => {
      const req = indexedDB.open(name, 1)
      req.onupgradeneeded = () => {
        req.result.createObjectStore('library')
      }
      req.onsuccess = () => {
        const db = req.result
        const t = db.transaction('library', 'readwrite')
        t.objectStore('library').put(lib(2), 'library')
        t.oncomplete = () => {
          db.close()
          resolve()
        }
        t.onerror = () => reject(t.error)
      }
      req.onerror = () => reject(req.error)
    })

    const repo = new IdbVocabRepo(name)
    expect((await repo.load()).items).toHaveLength(2)
    await repo.save(lib(4))
    const snapshots = await repo.listSnapshots()
    expect(snapshots).toHaveLength(1)
    expect((await repo.loadSnapshot(snapshots[0].at))?.items).toHaveLength(4)
  })
})
