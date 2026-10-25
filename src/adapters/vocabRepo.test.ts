import { describe, it, expect } from 'vitest'
import { MemoryVocabRepo } from './vocabRepo'
import { createLibrary } from '../core/vocab'
import { vocabItem } from '../core/testFixtures'

/**
 * 词库仓储的**历史快照**语义：每次保存追加一版，取回时新的在前。
 *
 * 「恢复上一版」已下线（用户要求删掉这个功能），仓储不再维护单独的 prev 槽位；
 * 误清/误导入靠「导出全部」备份与快照手工救回。
 */
const lib = (n: number) => ({
  ...createLibrary(),
  items: Array.from({ length: n }, (_, i) => vocabItem({ id: `w${i}`, word: `w${i}`, lemma: `w${i}` })),
})

describe('MemoryVocabRepo：历史快照', () => {
  it('每次保存留一版快照，按时间新的在前', async () => {
    const repo = new MemoryVocabRepo()
    await repo.save(lib(3))
    await repo.save(lib(5))
    const snaps = await repo.listSnapshots?.()
    expect(snaps?.length).toBe(2)
    expect((await repo.loadSnapshot?.(snaps![0].at))?.items).toHaveLength(5)
  })
})
