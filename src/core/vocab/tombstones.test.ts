import { afterEach, describe, expect, it, vi } from 'vitest'
import { createLibrary } from '../vocab'
import { vocabItem } from '../testFixtures'
import { addArticleEntry, removeArticleEntry } from '../articleVocab'
import { removeItem } from './library'
import { applyTombstones, mergeLibrariesForSync } from './tombstones'

const NOW = '2026-10-24T12:00:00.000Z'

const item = (over: Parameters<typeof vocabItem>[0] = {}) =>
  vocabItem({
    id: 'vocab:bank',
    word: 'bank',
    lemma: 'bank',
    createdAt: '2026-10-01T00:00:00.000Z',
    updatedAt: '2026-10-01T00:00:00.000Z',
    ...over,
  })

afterEach(() => {
  vi.useRealTimers()
})

describe('词库墓碑：删除不会被合并复活', () => {
  it('removeItem 写墓碑；服务端还留着旧词时，合并结果里没有它', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(NOW))
    const local = removeItem({ ...createLibrary(), items: [item()] }, 'vocab:bank')
    expect(local.tombstones?.[0]).toMatchObject({ kind: 'item', lemma: 'bank', at: NOW })
    expect(applyTombstones(local).items).toHaveLength(0)

    const server = { ...createLibrary(), items: [item()] }
    const merged = mergeLibrariesForSync(local, server)
    expect(merged.items).toHaveLength(0)
    expect(merged.tombstones).toHaveLength(1)
  })

  it('删全库词条会连带删掉服务端那篇的收录（不留孤儿条目）', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(NOW))
    const local = removeItem({ ...createLibrary(), items: [item()] }, 'vocab:bank')
    let server = { ...createLibrary(), items: [item()] }
    server = addArticleEntry(server, {
      articleId: 'art-1',
      lemma: 'bank',
      origin: 'manual',
    }, new Date('2026-10-01T00:00:00.000Z'))

    const merged = mergeLibrariesForSync(local, server)
    expect(merged.items).toHaveLength(0)
    expect(merged.articleEntries).toHaveLength(0)
  })

  it('删完又加回来的新词（updatedAt 晚于墓碑）不会被误删', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(NOW))
    const local = removeItem({ ...createLibrary(), items: [item()] }, 'vocab:bank')
    const readded = {
      ...local,
      items: [item({ updatedAt: '2026-10-25T00:00:00.000Z' })],
    }
    expect(applyTombstones(readded).items).toHaveLength(1)
  })

  it('服务端删了、本机有新版本：合并保留本机的新版本', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(NOW))
    const server = removeItem({ ...createLibrary(), items: [item()] }, 'vocab:bank')
    const local = {
      ...createLibrary(),
      items: [item({ meaning: '银行', updatedAt: '2026-10-25T00:00:00.000Z' })],
    }
    const merged = mergeLibrariesForSync(local, server)
    expect(merged.items).toHaveLength(1)
    expect(merged.items[0].meaning).toBe('银行')
  })

  it('同一条两边都改过：updatedAt 更新的赢', () => {
    const local = { ...createLibrary(), items: [item({ meaning: '本机', updatedAt: '2026-10-24T00:00:00.000Z' })] }
    const server = { ...createLibrary(), items: [item({ meaning: '服务端', updatedAt: '2026-10-23T00:00:00.000Z' })] }
    expect(mergeLibrariesForSync(local, server).items[0].meaning).toBe('本机')

    const localOld = { ...createLibrary(), items: [item({ meaning: '本机', updatedAt: '2026-10-22T00:00:00.000Z' })] }
    const serverNew = { ...createLibrary(), items: [item({ meaning: '服务端', updatedAt: '2026-10-23T00:00:00.000Z' })] }
    expect(mergeLibrariesForSync(localOld, serverNew).items[0].meaning).toBe('服务端')
  })

  it('篇条目也有墓碑：从这篇移出后不会被并回来', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(NOW))
    let local = { ...createLibrary(), items: [item()] }
    local = addArticleEntry(local, { articleId: 'art-1', lemma: 'bank', origin: 'manual' }, new Date('2026-10-01T00:00:00.000Z'))
    local = removeArticleEntry(local, 'art-1', 'bank')
    expect(local.tombstones?.some((t) => t.kind === 'article')).toBe(true)

    let server = { ...createLibrary(), items: [item()] }
    server = addArticleEntry(server, { articleId: 'art-1', lemma: 'bank', origin: 'manual' }, new Date('2026-10-01T00:00:00.000Z'))
    const merged = mergeLibrariesForSync(local, server)
    expect(merged.articleEntries).toHaveLength(0)
  })
})
