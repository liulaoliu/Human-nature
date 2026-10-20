import { describe, expect, it } from 'vitest'
import { SAME_EDIT_SEC, addSplit, editCount, mergeAt } from './chunkEditLog'

describe('addSplit（撕开）', () => {
  it('新刀口记进 splits', () => {
    const log = addSplit({ splits: [], merges: [] }, 3.5)
    expect(log?.splits).toEqual([3.5])
  })

  it('同一刀口重复点不重复记（容差内算同一条）', () => {
    expect(addSplit({ splits: [3.5], merges: [] }, 3.5)).toBeNull()
    expect(addSplit({ splits: [3.5], merges: [] }, 3.5 + SAME_EDIT_SEC / 2)).toBeNull()
  })

  it('差得够远算新刀口', () => {
    expect(addSplit({ splits: [3.5], merges: [] }, 3.5 + SAME_EDIT_SEC * 3)?.splits).toHaveLength(2)
  })

  it('撕在以前合并过的边界上 = 撤销那次合并', () => {
    const log = addSplit({ splits: [], merges: [3.5, 9] }, 3.5)
    expect(log?.splits).toEqual([3.5])
    expect(log?.merges).toEqual([9])
  })
})

describe('mergeAt（合并 = 删掉一条边界）', () => {
  it('普通边界：记一条 merge', () => {
    const log = mergeAt({ splits: [3.5], merges: [] }, 7)
    expect(log).toEqual({ splits: [3.5], merges: [7] })
  })

  it('撤销撕开：只删 split，不新增 merge（界面计数才能干净归零）', () => {
    const log = mergeAt({ splits: [3.5], merges: [] }, 3.5)
    expect(log).toEqual({ splits: [], merges: [] })
  })

  it('重复合并同一条边界不会记两条', () => {
    const log = mergeAt(mergeAt({ splits: [], merges: [] }, 7), 7)
    expect(log.merges).toEqual([7])
  })

  it('已知边界情况：合并 → 撕开 → 再合并，最后一刀被当成「撤销撕开」', () => {
    // 这条钉住的是现状（不是理想行为）：见 chunkEditLog.ts 的说明与 TODO 观察项
    const afterSplit = addSplit(mergeAt({ splits: [], merges: [] }, 7), 7)
    expect(afterSplit?.merges).toEqual([])
    expect(mergeAt(afterSplit!, 7)).toEqual({ splits: [], merges: [] })
  })
})

describe('editCount', () => {
  it('刀口 + 合并都算（清零后才会重跑 VAD）', () => {
    expect(editCount({ splits: [], merges: [] })).toBe(0)
    expect(editCount({ splits: [1, 2], merges: [3] })).toBe(3)
  })
})
