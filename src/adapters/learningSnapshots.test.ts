import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ storeRequest: vi.fn() }))
vi.mock('./storeApi', () => ({ storeRequest: mocks.storeRequest }))

import {
  createLearningSnapshot,
  listLearningSnapshots,
  restoreLearningSnapshot,
} from './learningSnapshots'

beforeEach(() => {
  mocks.storeRequest.mockReset()
})

describe('学习快照客户端', () => {
  it('列表响应先过守卫：坏条目丢弃并计数', async () => {
    mocks.storeRequest.mockResolvedValue({
      ok: true,
      value: [
        { at: '2026-01-02T00:00:00.000Z', reason: 'auto', bytes: 2048 },
        { at: 'bad', bytes: 1 },
        { at: '2026-01-01T00:00:00.000Z', reason: 'manual', bytes: 1024 },
      ],
    })
    const out = await listLearningSnapshots()
    expect(out.dropped).toBe(1)
    expect(out.snapshots.map((s) => s.reason)).toEqual(['auto', 'manual'])
    expect(mocks.storeRequest).toHaveBeenCalledWith('/learning/snapshots', {}, undefined, 3000)
  })

  it('接口说不 ok 就抛，不让界面把空列表当成功', async () => {
    mocks.storeRequest.mockResolvedValue({ ok: false })
    await expect(listLearningSnapshots()).rejects.toThrow(/不可用/)
  })

  it('手动拍快照：返回 at，去重返回 null', async () => {
    mocks.storeRequest.mockResolvedValueOnce({ ok: true, value: '2026-01-01T00:00:00.000Z' })
    await expect(createLearningSnapshot()).resolves.toBe('2026-01-01T00:00:00.000Z')
    mocks.storeRequest.mockResolvedValueOnce({ ok: true, value: null })
    await expect(createLearningSnapshot()).resolves.toBeNull()
  })

  it('恢复把 at 放进 body；失败时带出服务端原因', async () => {
    mocks.storeRequest.mockResolvedValue({ ok: true })
    await restoreLearningSnapshot('2026-01-01T00:00:00.000Z')
    expect(mocks.storeRequest).toHaveBeenLastCalledWith(
      '/learning/snapshots/restore',
      { method: 'POST', body: JSON.stringify({ at: '2026-01-01T00:00:00.000Z' }) },
      undefined,
      10000,
    )

    mocks.storeRequest.mockResolvedValue({ ok: false, error: '找不到这张学习快照' })
    await expect(restoreLearningSnapshot('x')).rejects.toThrow('找不到这张学习快照')
  })
})
