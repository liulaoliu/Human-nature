import { describe, it, expect } from 'vitest'
import { MemoryVocabRepo } from './vocabRepo'
import { createLibrary } from '../core/vocab'
import { vocabItem } from '../core/testFixtures'

/**
 * 词库仓储的**备份语义**：每次覆盖前留一份「上一版」，且**只留更大的那一份**。
 *
 * 为什么这么设计（真实事故）：词库从 IndexedDB 读失败时拿到的是空库；
 * 一旦有任何写入（含自动补全），空库就被覆盖回去 —— 生词全丢。
 * 备份只变大不缩小 ⇒ 缩水事故发生时，备份里留住的正是事故前那一版，能一键恢复。
 */
const lib = (n: number) => ({
  ...createLibrary(),
  items: Array.from({ length: n }, (_, i) => vocabItem({ id: `w${i}`, word: `w${i}`, lemma: `w${i}` })),
})

describe('MemoryVocabRepo：上一版备份', () => {
  it('保存新版本后，能取到上一次那一版', async () => {
    const repo = new MemoryVocabRepo()
    await repo.save(lib(3))
    expect((await repo.load()).items).toHaveLength(3)
    expect(await repo.loadPrev()).toBeNull() // 第一次保存：没有更早的

    await repo.save(lib(5))
    expect((await repo.loadPrev())?.items).toHaveLength(3)
  })

  it('缩水（事故/误清）不会把备份也冲掉：备份只变大不缩小', async () => {
    const repo = new MemoryVocabRepo()
    await repo.save(lib(5))
    await repo.save(lib(7))
    expect((await repo.loadPrev())?.items).toHaveLength(5)

    // 事故：空库被写进去（正常流程里已被 persist 的硬闸拦住，这里防的是其它路径）
    await repo.save(lib(0))
    expect((await repo.loadPrev())?.items).toHaveLength(7) // 备份仍是最大的那一版（7）
    expect((await repo.load()).items).toHaveLength(0)
  })

  it('恢复：把上一版写回去，之后还能再退一次', async () => {
    const repo = new MemoryVocabRepo()
    await repo.save(lib(2))
    await repo.save(lib(4))
    const prev = await repo.loadPrev()
    await repo.save(prev!) // 恢复 = 再写一次
    expect((await repo.load()).items).toHaveLength(2)
  })

  it('clear 之后还能靠备份找回（清库也可挽回）', async () => {
    const repo = new MemoryVocabRepo()
    await repo.save(lib(6))
    await repo.clear()
    expect((await repo.load()).items).toHaveLength(0)
    expect((await repo.loadPrev())?.items).toHaveLength(6)
  })
})
