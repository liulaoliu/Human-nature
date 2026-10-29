import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { HybridVocabRepo, MemoryVocabRepo } from './vocabRepo'
import { StoreConflictError } from './storeApi'
import { createLibrary } from '../core/vocab'
import { vocabItem } from '../core/testFixtures'

const { storeHealth, storeRequest } = vi.hoisted(() => ({
  storeHealth: vi.fn(),
  storeRequest: vi.fn(),
}))

vi.mock('./storeApi', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./storeApi')>()
  return { ...actual, storeHealth, storeRequest }
})

const lib = (n: number) => ({
  ...createLibrary(),
  items: Array.from({ length: n }, (_, i) => vocabItem({ id: `w${i}`, word: `w${i}`, lemma: `w${i}` })),
})

beforeEach(() => {
  storeHealth.mockReset()
  storeRequest.mockReset()
  storeHealth.mockResolvedValue(true)
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-10-24T00:00:00.000Z'))
})

afterEach(() => {
  vi.useRealTimers()
})

describe('HybridVocabRepo：读失败后不许强制覆盖', () => {
  it('读失败 → 服务恢复后先补 GET；服务端已有数据则按冲突拒绝，不发 PUT', async () => {
    const local = new MemoryVocabRepo()
    await local.save(lib(2))
    storeRequest.mockRejectedValueOnce(new Error('read failed'))
    const repo = new HybridVocabRepo(local)

    expect((await repo.load()).items).toHaveLength(2)
    // 跳过 HybridMode 的 30s 退避，模拟服务恢复
    vi.advanceTimersByTime(30_001)
    storeRequest.mockResolvedValueOnce({ value: lib(5), updatedAt: 'srv-2' })

    await expect(repo.save(lib(3))).rejects.toBeInstanceOf(StoreConflictError)
    expect(storeRequest).toHaveBeenCalledTimes(2)
    expect(storeRequest.mock.calls[1][0]).toBe('/vocab')
    expect(storeRequest.mock.calls[1][1]).toEqual({})
    // 没有 base 的 PUT 会强制覆盖服务器，绝不能发
    expect(storeRequest.mock.calls.some((c) => c[1]?.method === 'PUT')).toBe(false)
  })

  it('读失败但服务端确实为空：补 GET 后允许写入，且 PUT 带超时', async () => {
    const local = new MemoryVocabRepo()
    storeRequest.mockRejectedValueOnce(new Error('read failed'))
    const repo = new HybridVocabRepo(local)

    await repo.load()
    vi.advanceTimersByTime(30_001)
    storeRequest
      .mockResolvedValueOnce({ value: null, updatedAt: null })
      .mockResolvedValueOnce({ updatedAt: 'srv-1' })

    await repo.save(lib(3))
    const put = storeRequest.mock.calls.find((c) => c[1]?.method === 'PUT')
    expect(put?.[0]).toBe('/vocab')
    expect(put?.[3]).toBe(12_000)
    expect((put?.[1]?.headers as Record<string, string> | undefined)?.['X-Vocab-Base']).toBeUndefined()
  })

  it('正常读到的版本号会作为下次 PUT 的 base', async () => {
    storeRequest.mockResolvedValueOnce({ value: lib(4), updatedAt: 'srv-1' })
    const repo = new HybridVocabRepo(new MemoryVocabRepo())
    await repo.load()

    storeRequest.mockResolvedValueOnce({ updatedAt: 'srv-2' })
    await repo.save(lib(4))
    const put = storeRequest.mock.calls.find((c) => c[1]?.method === 'PUT')
    expect((put?.[1]?.headers as Record<string, string>)?.['X-Vocab-Base']).toBe('srv-1')
  })
})

describe('HybridVocabRepo：冲突后本页只读', () => {
  it('撞过 409 后，下一次自动保存不许拿新版本号把旧词库写上去', async () => {
    storeRequest.mockResolvedValueOnce({ value: lib(4), updatedAt: 'srv-1' })
    const repo = new HybridVocabRepo(new MemoryVocabRepo())
    await repo.load()

    // 第一次写：别处已经写过 → 409，并带回服务端的最新版本号
    storeRequest.mockRejectedValueOnce(
      new StoreConflictError('词库已被其它页面改过', { updatedAt: 'srv-2', count: 5 }),
    )
    await expect(repo.save(lib(3))).rejects.toBeInstanceOf(StoreConflictError)

    // 第二次（自动补全触发的保存）：绝不能带着 srv-2 去 PUT
    storeRequest.mockClear()
    await expect(repo.save(lib(3))).rejects.toBeInstanceOf(StoreConflictError)
    expect(storeRequest).not.toHaveBeenCalled()
  })

  it('重新 load 之后解除封锁（刷新页面才继续写）', async () => {
    storeRequest.mockResolvedValueOnce({ value: lib(4), updatedAt: 'srv-1' })
    const repo = new HybridVocabRepo(new MemoryVocabRepo())
    await repo.load()
    storeRequest.mockRejectedValueOnce(new StoreConflictError('conflict', { updatedAt: 'srv-2', count: 5 }))
    await expect(repo.save(lib(3))).rejects.toBeInstanceOf(StoreConflictError)

    storeRequest.mockResolvedValueOnce({ value: lib(4), updatedAt: 'srv-2' })
    await repo.load()
    storeRequest.mockClear()
    storeRequest.mockResolvedValueOnce({ updatedAt: 'srv-3' })
    await repo.save(lib(4))
    const put = storeRequest.mock.calls.find((c) => c[1]?.method === 'PUT')
    expect((put?.[1]?.headers as Record<string, string>)?.['X-Vocab-Base']).toBe('srv-2')
  })
})

describe('HybridVocabRepo：本地镜像比服务端新', () => {
  it('离线期间写进 IndexedDB 的改动不被服务端旧版顶掉', async () => {
    const local = new MemoryVocabRepo()
    const localLib = {
      ...lib(2),
      items: [vocabItem({ id: 'local', word: 'local', lemma: 'local' })],
    }
    await local.save(localLib) // fake time 2026-10-24
    await local.markDirty() // 模拟离线期间服务端写失败
    storeRequest.mockResolvedValueOnce({
      value: { ...lib(1), items: [vocabItem({ id: 'server', word: 'server', lemma: 'server' })] },
      updatedAt: '2026-10-23T00:00:00.000Z',
    })

    const repo = new HybridVocabRepo(local)
    const loaded = await repo.load()
    // 本机离线词 + 服务端旧词都保留：按 lemma 合并，不再整库二选一。
    expect(loaded.items.map((it) => it.id)).toEqual(['server', 'local'])
    expect(repo.takeNotice()?.message).toContain('已合并')
  })

  it('服务端确实更新时仍用服务端版本', async () => {
    const local = new MemoryVocabRepo()
    vi.setSystemTime(new Date('2026-10-20T00:00:00.000Z'))
    await local.save({ ...lib(1), items: [vocabItem({ id: 'old-local', word: 'old', lemma: 'old' })] })
    vi.setSystemTime(new Date('2026-10-24T00:00:00.000Z'))
    storeRequest.mockResolvedValueOnce({
      value: { ...lib(1), items: [vocabItem({ id: 'server-new', word: 'new', lemma: 'new' })] },
      updatedAt: '2026-10-23T00:00:00.000Z',
    })

    const loaded = await new HybridVocabRepo(local).load()
    expect(loaded.items.map((it) => it.id)).toEqual(['server-new'])
  })

  it('镜像时间更晚但没有未同步标记 → 仍用服务端（别把镜像当成改动）', async () => {
    const local = new MemoryVocabRepo()
    await local.save(lib(2)) // 只是成功保存后的镜像，没有 markDirty
    storeRequest.mockResolvedValueOnce({
      value: { ...lib(1), items: [vocabItem({ id: 'server', word: 'server', lemma: 'server' })] },
      updatedAt: '2026-10-23T00:00:00.000Z',
    })

    const loaded = await new HybridVocabRepo(local).load()
    expect(loaded.items.map((it) => it.id)).toEqual(['server'])
  })

  it('服务端保存失败 → 本机置脏，下次启动才允许本机优先', async () => {
    const local = new MemoryVocabRepo()
    storeRequest.mockRejectedValueOnce(new Error('offline'))
    const repo = new HybridVocabRepo(local)

    await repo.save(lib(3))

    expect(await local.isDirty()).toBe(true)
    expect((await local.load()).items).toHaveLength(3)
  })

  it('服务端保存成功 → 清掉之前的未同步标记', async () => {
    const local = new MemoryVocabRepo()
    await local.markDirty()
    storeRequest
      .mockResolvedValueOnce({ value: null, updatedAt: null }) // ensureRevisionKnown：服务端为空
      .mockResolvedValueOnce({ updatedAt: 'srv-1' }) // PUT 成功
    const repo = new HybridVocabRepo(local)

    await repo.save(lib(2))
    await Promise.resolve()
    await Promise.resolve()

    expect(await local.isDirty()).toBe(false)
  })
})
