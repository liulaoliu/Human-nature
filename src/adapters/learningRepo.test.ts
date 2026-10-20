import { beforeEach, describe, expect, it, vi } from 'vitest'
import { emptyLearning, type LearningData } from '../core/learning'
import { storeHealth, storeRequest } from './storeApi'
import { SqliteLearningRepo } from './learningRepo'

vi.mock('./storeApi', () => ({
  storeHealth: vi.fn(),
  storeRequest: vi.fn(),
}))

const health = vi.mocked(storeHealth)
const request = vi.mocked(storeRequest)

const data: LearningData = {
  ...emptyLearning(),
  practice: [{ at: '2026-10-20T00:00:00.000Z', kind: 'quiz', total: 4, correct: 3 }],
}

beforeEach(() => {
  health.mockReset()
  request.mockReset()
})

describe('SqliteLearningRepo：服务不可用', () => {
  it('health=false：load/migrate 返回 null，save 抛错，且下次会重新探测', async () => {
    health.mockResolvedValue(false)
    const repo = new SqliteLearningRepo()
    await expect(repo.load()).resolves.toBeNull()
    await expect(repo.save(data)).rejects.toThrow('学习记录服务不可用')
    await expect(repo.savePartial({ practice: [] })).rejects.toThrow('学习记录服务不可用')
    await expect(repo.migrate(data)).resolves.toBeNull()
    expect(request).not.toHaveBeenCalled()
    // 不缓存 false：用户可能稍后启动服务
    expect(health).toHaveBeenCalledTimes(4)
  })
})

describe('SqliteLearningRepo：正常读写', () => {
  it('load：走 /learning 并归一化（坏数据不炸）', async () => {
    health.mockResolvedValue(true)
    request.mockResolvedValue({ ok: true, value: data })
    const repo = new SqliteLearningRepo()
    const got = await repo.load()
    expect(request).toHaveBeenCalledWith('/learning', {}, undefined, 2000)
    expect(got?.practice).toHaveLength(1)

    request.mockResolvedValue({ ok: true, value: { practice: 'nope' } })
    const cleaned = await repo.load()
    expect(cleaned?.practice).toEqual([])
  })

  it('health=true 只探测一次（同一实例内缓存）', async () => {
    health.mockResolvedValue(true)
    request.mockResolvedValue({ ok: true, value: data })
    const repo = new SqliteLearningRepo()
    await repo.load()
    await repo.load()
    expect(health).toHaveBeenCalledTimes(1)
  })

  it('save：PUT 整份；savePartial：PUT 增量', async () => {
    health.mockResolvedValue(true)
    request.mockResolvedValue({ ok: true })
    const repo = new SqliteLearningRepo()
    await repo.save(data)
    expect(request).toHaveBeenCalledWith(
      '/learning',
      { method: 'PUT', body: JSON.stringify(data) },
      undefined,
      3000,
    )

    await repo.savePartial({ practice: data.practice })
    expect(request).toHaveBeenLastCalledWith(
      '/learning/partial',
      { method: 'PUT', body: JSON.stringify({ practice: data.practice }) },
      undefined,
      3000,
    )
  })

  it('migrate：返回 migrated 标记与归一化后的 value', async () => {
    health.mockResolvedValue(true)
    request.mockResolvedValue({ ok: true, migrated: true, value: data })
    const repo = new SqliteLearningRepo()
    await expect(repo.migrate(data)).resolves.toEqual({ migrated: true, value: data })
    expect(request).toHaveBeenCalledWith(
      '/learning/if-empty',
      { method: 'PUT', body: JSON.stringify(data) },
      undefined,
      3000,
    )

    request.mockResolvedValue({ ok: true, value: data })
    const got = await repo.migrate(data)
    expect(got?.migrated).toBe(false)
  })
})

describe('SqliteLearningRepo：重建派生聚合', () => {
  it('rebuildDerived：POST /learning/rebuild-derived 并归一化返回', async () => {
    health.mockResolvedValue(true)
    request.mockResolvedValue({ ok: true, value: data })
    const repo = new SqliteLearningRepo()
    const got = await repo.rebuildDerived()
    expect(request).toHaveBeenCalledWith('/learning/rebuild-derived', { method: 'POST' }, undefined, 5000)
    expect(got?.practice).toHaveLength(1)

    // 服务端返回脏数据：归一化兜住，不把坏形状带给上层
    request.mockResolvedValue({ ok: true, value: { activity: 'nope' } })
    const cleaned = await repo.rebuildDerived()
    expect(cleaned?.activity).toEqual([])
  })

  it('rebuildDerived：服务不可用返回 null（不抛）', async () => {
    health.mockResolvedValue(false)
    const repo = new SqliteLearningRepo()
    await expect(repo.rebuildDerived()).resolves.toBeNull()
    expect(request).not.toHaveBeenCalled()
  })
})
