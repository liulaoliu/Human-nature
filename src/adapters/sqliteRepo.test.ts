import { afterEach, describe, expect, it, vi } from 'vitest'
import { createLibrary } from '../core/vocab'
import { vocabItem } from '../core/testFixtures'
import { MemoryVocabRepo, HybridVocabRepo } from './vocabRepo'
import { MemoryArticleRepo, HybridArticleRepo } from './articleRepo'
import type { SavedArticle } from '../core/ports'

const lib = (n: number) => ({
  ...createLibrary(),
  items: Array.from({ length: n }, (_, i) => vocabItem({ id: `w${i}`, word: `w${i}`, lemma: `w${i}` })),
})

const article = (id: string, updatedAt = '2026-01-01T00:00:00.000Z'): SavedArticle => ({
  id,
  title: id,
  text: `text-${id}`,
  paragraphs: [],
  sentences: [],
  sourceKey: null,
  updatedAt,
})

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function mockStore(handlers: Record<string, (init?: RequestInit) => Response>) {
  const calls: { path: string; init?: RequestInit }[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input)
      calls.push({ path, init })
      const fn = handlers[path]
      if (!fn) return jsonResponse({ ok: false, error: 'not found' }, 404)
      return fn(init)
    }),
  )
  return calls
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  vi.useRealTimers()
})

describe('HybridVocabRepo：SQLite 优先，IndexedDB 兜底', () => {
  it('服务端空库时把 IndexedDB 旧词库迁上去', async () => {
    const local = new MemoryVocabRepo()
    await local.save(lib(3))
    const calls = mockStore({
      '/api/store/health': () => jsonResponse({ ok: true }),
      '/api/store/vocab': () => jsonResponse({ ok: true, value: null }),
      '/api/store/vocab/if-empty': (init) => {
        const body = JSON.parse(String(init?.body))
        return jsonResponse({ ok: true, migrated: true, value: body })
      },
    })

    const repo = new HybridVocabRepo(local)
    const loaded = await repo.load()
    expect(loaded.items).toHaveLength(3)
    expect(calls.map((c) => c.path)).toContain('/api/store/vocab/if-empty')
  })

  it('服务端已有词库时以 SQLite 为准，不被旧 IndexedDB 覆盖', async () => {
    const local = new MemoryVocabRepo()
    await local.save(lib(2))
    mockStore({
      '/api/store/health': () => jsonResponse({ ok: true }),
      '/api/store/vocab': () =>
        jsonResponse({ ok: true, value: lib(7), updatedAt: '2026-10-01T00:00:00.000Z' }),
    })

    const repo = new HybridVocabRepo(local)
    expect((await repo.load()).items).toHaveLength(7)
  })

  it('保存写 SQLite，同时镜像 IndexedDB', async () => {
    const local = new MemoryVocabRepo()
    const calls = mockStore({
      '/api/store/health': () => jsonResponse({ ok: true }),
      '/api/store/vocab': (init) => {
        if (init?.method === 'PUT') return jsonResponse({ ok: true })
        return jsonResponse({ ok: true, value: null })
      },
    })

    const repo = new HybridVocabRepo(local)
    await repo.load()
    await repo.save(lib(4))
    expect(calls.some((c) => c.path === '/api/store/vocab' && c.init?.method === 'PUT')).toBe(true)
    expect((await local.load()).items).toHaveLength(4)
  })

  it('保存时把「我读到的那一版」带回去（乐观锁的 base）', async () => {
    const local = new MemoryVocabRepo()
    const calls = mockStore({
      '/api/store/health': () => jsonResponse({ ok: true }),
      '/api/store/vocab': (init) =>
        init?.method === 'PUT'
          ? jsonResponse({ ok: true, updatedAt: 'v2' })
          : jsonResponse({ ok: true, value: lib(3), updatedAt: 'v1' }),
    })

    const repo = new HybridVocabRepo(local)
    await repo.load()
    await repo.save(lib(4))
    const put = calls.filter((c) => c.init?.method === 'PUT').at(-1)
    expect(new Headers(put?.init?.headers as HeadersInit).get('X-Vocab-Base')).toBe('v1')

    // 写成功后版本号换成服务端返回的那个，下一次写才对得上
    await repo.save(lib(5))
    const second = calls.filter((c) => c.init?.method === 'PUT').at(-1)
    expect(new Headers(second?.init?.headers as HeadersInit).get('X-Vocab-Base')).toBe('v2')
  })

  it('别处先写过：409 就报错，不当成服务挂掉、也不镜像本地', async () => {
    const local = new MemoryVocabRepo()
    await local.save(lib(9))
    let rejected = 0
    mockStore({
      '/api/store/health': () => jsonResponse({ ok: true }),
      '/api/store/vocab': (init) => {
        if (init?.method === 'PUT') {
          rejected++
          // 第一次冲突，第二次（版本号已对齐）放行
          return rejected === 1
            ? jsonResponse({ ok: false, error: '词库已被其它页面改过', updatedAt: 'v2', count: 12 }, 409)
            : jsonResponse({ ok: true, updatedAt: 'v3' })
        }
        return jsonResponse({ ok: true, value: lib(3), updatedAt: 'v1' })
      },
    })

    const repo = new HybridVocabRepo(local)
    await repo.load()
    await expect(repo.save(lib(4))).rejects.toThrow(/改过/)
    // 关键：冲突不能把词库镜像到 IndexedDB（那才是真丢数据）
    expect((await local.load()).items).toHaveLength(9)

    // 版本号已经对齐服务器，用户再存一次就放行（此时 prev/快照里有被覆盖的那一版）
    await repo.save(lib(4))
    expect(rejected).toBe(2)
  })

  it('服务不可用时完全回退 IndexedDB', async () => {
    const local = new MemoryVocabRepo()
    await local.save(lib(5))
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ ok: false }, 503)))

    const repo = new HybridVocabRepo(local)
    expect((await repo.load()).items).toHaveLength(5)
    await repo.save(lib(6))
    expect((await local.load()).items).toHaveLength(6)
  })
})

describe('HybridArticleRepo：SQLite 优先，IndexedDB 兜底', () => {
  it('服务端没有的文章从 IndexedDB 补上去', async () => {
    const local = new MemoryArticleRepo()
    await local.save(article('a1'))
    const calls = mockStore({
      '/api/store/health': () => jsonResponse({ ok: true }),
      '/api/store/articles': () => jsonResponse({ ok: true, articles: [] }),
      '/api/store/articles/a1': () => jsonResponse({ ok: true }),
    })

    const repo = new HybridArticleRepo(local)
    await repo.reconcile?.()
    const list = await repo.list()
    expect(list.map((a) => a.id)).toEqual(['a1'])
    expect(calls.some((c) => c.path === '/api/store/articles/a1' && c.init?.method === 'PUT')).toBe(true)
  })

  it('list 是只读的：本地较新的文章只合并显示，不顺手 PUT', async () => {
    const local = new MemoryArticleRepo()
    await local.save(article('a1'))
    const calls = mockStore({
      '/api/store/health': () => jsonResponse({ ok: true }),
      '/api/store/articles': () => jsonResponse({ ok: true, articles: [] }),
    })

    const repo = new HybridArticleRepo(local)
    const list = await repo.list()
    expect(list.map((a) => a.id)).toEqual(['a1'])
    expect(calls.some((c) => c.init?.method === 'PUT')).toBe(false)
    // get 同理：读不到就读本地兜底，迁移交给 reconcile
    const got = await repo.get('a1')
    expect(got?.id).toBe('a1')
    expect(calls.some((c) => c.init?.method === 'PUT')).toBe(false)
  })

  it('保存 / 删除同时写 SQLite 与 IndexedDB 镜像', async () => {
    const local = new MemoryArticleRepo()
    const calls = mockStore({
      '/api/store/health': () => jsonResponse({ ok: true }),
      '/api/store/articles/a2': () => jsonResponse({ ok: true }),
      '/api/store/articles': () => jsonResponse({ ok: true, articles: [] }),
    })

    const repo = new HybridArticleRepo(local)
    await repo.save(article('a2'))
    expect((await local.get('a2'))?.id).toBe('a2')
    await repo.remove('a2')
    expect(await local.get('a2')).toBeNull()
    expect(calls.filter((c) => c.path === '/api/store/articles/a2').length).toBe(2)
  })

  it('服务端失败时回退 IndexedDB', async () => {
    const local = new MemoryArticleRepo()
    await local.save(article('a3'))
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ ok: false }, 503)))

    const repo = new HybridArticleRepo(local)
    expect((await repo.list()).map((a) => a.id)).toEqual(['a3'])
    await repo.save(article('a4'))
    expect((await local.get('a4'))?.id).toBe('a4')
  })
})
