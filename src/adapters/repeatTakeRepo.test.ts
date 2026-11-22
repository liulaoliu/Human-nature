// @vitest-environment node
import 'fake-indexeddb/auto'
import { describe, expect, it } from 'vitest'
import { IdbRepeatTakeRepo, MemoryRepeatTakeRepo } from './repeatTakeRepo'
import { repeatTakeId, type RepeatTake } from '../core/repeatTake'

function take(articleKey: string, sentenceId: string, text = 'Run fast.'): RepeatTake {
  return {
    id: repeatTakeId(articleKey, sentenceId),
    articleKey,
    sentenceId,
    sentenceText: text,
    blob: new Blob(['x'], { type: 'audio/webm' }),
    mimeType: 'audio/webm',
    durationSec: 2,
    createdAt: 1,
  }
}

describe('IdbRepeatTakeRepo：真实 IndexedDB 读写', () => {
  it('put / get / 同句覆盖 / remove', async () => {
    const repo = new IdbRepeatTakeRepo()
    const key = `doc:${Math.random()}`
    const a = take(key, 's1')
    await repo.put(a)
    expect((await repo.get(a.id))?.sentenceText).toBe('Run fast.')

    await repo.put({ ...a, sentenceText: 'Run faster.', durationSec: 3 })
    const again = await repo.get(a.id)
    expect(again?.sentenceText).toBe('Run faster.')
    expect(again?.durationSec).toBe(3)

    await repo.remove(a.id)
    expect(await repo.get(a.id)).toBeUndefined()
  })

  it('list 只取本篇；prune 删孤儿、留有效', async () => {
    const repo = new IdbRepeatTakeRepo()
    const key = `doc:${Math.random()}`
    const other = `doc:${Math.random()}`
    const a = take(key, 's1')
    const b = take(key, 's2')
    const c = take(other, 's1')
    await repo.put(a)
    await repo.put(b)
    await repo.put(c)

    expect((await repo.list(key)).map((t) => t.sentenceId).sort()).toEqual(['s1', 's2'])
    expect(await repo.prune(key, new Set([a.id]))).toBe(1)
    expect((await repo.list(key)).map((t) => t.sentenceId)).toEqual(['s1'])
    // 别的文章不受影响
    expect(await repo.get(c.id)).toBeTruthy()
  })
})

describe('MemoryRepeatTakeRepo：兜底实现同形', () => {
  it('get / put / list / prune', async () => {
    const repo = new MemoryRepeatTakeRepo()
    const key = 'doc:mem'
    await repo.put(take(key, 's1'))
    await repo.put(take(key, 's2'))
    expect(await repo.list(key)).toHaveLength(2)
    expect(await repo.prune(key, new Set([repeatTakeId(key, 's1')]))).toBe(1)
    expect(await repo.list(key)).toHaveLength(1)
  })
})
