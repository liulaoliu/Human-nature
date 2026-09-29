import { describe, it, expect } from 'vitest'
import { applyChunkEdits, findQuietestSec, MIN_PIECE_SEC } from './chunkEdits'
import type { Chunk } from './ports'

const ch = (start: number, end: number, index: number): Chunk => ({ index, start, end })

describe('applyChunkEdits 撕开', () => {
  it('在第 5 秒把 [2,8] 撕成两段', () => {
    const out = applyChunkEdits([ch(2, 8, 0)], [5])
    expect(out).toEqual([ch(2, 5, 0), ch(5, 8, 1)])
  })

  it('只撕包含该时间的块，别的块不动', () => {
    const out = applyChunkEdits([ch(0, 2, 0), ch(3, 9, 1), ch(10, 12, 2)], [6])
    expect(out).toEqual([ch(0, 2, 0), ch(3, 6, 1), ch(6, 9, 2), ch(10, 12, 3)])
  })

  it('太靠边的刀口忽略（不制造碎片）', () => {
    const out = applyChunkEdits([ch(2, 8, 0)], [2 + MIN_PIECE_SEC / 2, 8 - MIN_PIECE_SEC / 2])
    expect(out).toEqual([ch(2, 8, 0)])
  })

  it('落在块外面的刀口忽略', () => {
    const out = applyChunkEdits([ch(2, 8, 0), ch(10, 12, 1)], [9, 20])
    expect(out).toEqual([ch(2, 8, 0), ch(10, 12, 1)])
  })

  it('一个块上多刀，按时间顺序切成多段', () => {
    const out = applyChunkEdits([ch(0, 9, 0)], [3, 6])
    expect(out).toEqual([ch(0, 3, 0), ch(3, 6, 1), ch(6, 9, 2)])
  })

  it('同一刀重复给也只切一次', () => {
    const out = applyChunkEdits([ch(0, 9, 0)], [4, 4.001])
    expect(out).toEqual([ch(0, 4, 0), ch(4, 9, 1)])
  })

  it('撕完拼起来还是原来的总时长（不重不漏）', () => {
    const base = [ch(0, 4, 0), ch(5, 13, 1), ch(14, 20, 2)]
    const out = applyChunkEdits(base, [2, 9, 17])
    const total = (cs: Chunk[]) => cs.reduce((a, c) => a + (c.end - c.start), 0)
    expect(total(out)).toBeCloseTo(total(base), 6)
    // 每一段都落在原来的某一块里，且前后不重叠
    expect(out[0].start).toBe(0)
    expect(out.at(-1)!.end).toBe(20)
    for (let i = 1; i < out.length; i++) expect(out[i].start).toBeGreaterThanOrEqual(out[i - 1].end)
    for (const piece of out) {
      expect(base.some((b) => piece.start >= b.start - 1e-9 && piece.end <= b.end + 1e-9)).toBe(true)
    }
  })
})

describe('applyChunkEdits 合并', () => {
  it('把起点是 3 的那块并进上一块', () => {
    const out = applyChunkEdits([ch(0, 2, 0), ch(3, 9, 1), ch(10, 12, 2)], [], [3])
    expect(out).toEqual([ch(0, 9, 0), ch(10, 12, 1)])
  })

  it('合并时间对不上任何边界时忽略', () => {
    const out = applyChunkEdits([ch(0, 2, 0), ch(3, 9, 1)], [], [4])
    expect(out).toEqual([ch(0, 2, 0), ch(3, 9, 1)])
  })

  it('第一块没有上一块，合并不了', () => {
    const out = applyChunkEdits([ch(0, 2, 0)], [], [0])
    expect(out).toEqual([ch(0, 2, 0)])
  })

  it('撕了再把那条边界合回去，等于没动', () => {
    const base = [ch(0, 4, 0), ch(5, 13, 1)]
    const split = applyChunkEdits(base, [9])
    expect(split).toEqual([ch(0, 4, 0), ch(5, 9, 1), ch(9, 13, 2)])
    // 在撕好的结果上「合并起点 9 的那块」→ 合回 [5,13]
    expect(applyChunkEdits(split, [9], [9])).toEqual(base)
    // 在原始块上同时给 split 和 merge 9，先撕后合，同样回到原样
    expect(applyChunkEdits(base, [9], [9])).toEqual(base)
  })
})

describe('applyChunkEdits 换切块粒度', () => {
  it('把刀口套用到另一套块上也认（找得到才切）', () => {
    // 换粒度后原来的 [0,10] 变成了 [0,6] 和 [6,10]
    const out = applyChunkEdits([ch(0, 6, 0), ch(6, 10, 1)], [3, 8])
    expect(out).toEqual([ch(0, 3, 0), ch(3, 6, 1), ch(6, 8, 2), ch(8, 10, 3)])
  })

  it('空块输入返回空', () => {
    expect(applyChunkEdits([], [1, 2])).toEqual([])
  })
})

describe('findQuietestSec', () => {
  it('在给定的静音段里找出最安静的位置', () => {
    const sr = 1000
    const samples = new Float32Array(sr * 2)
    // 0.5~1.3s 铺一点噪声，其余是 0（最安静在两端）
    for (let i = Math.round(0.5 * sr); i < Math.round(1.3 * sr); i++) samples[i] = 0.2
    const t = findQuietestSec(samples, sr, 0.4, 1.4)
    expect(t).toBeGreaterThanOrEqual(0.4)
    expect(t).toBeLessThanOrEqual(1.4)
    // 最安静的地方应该远离那截噪声
    expect(t < 0.5 || t > 1.3).toBe(true)
  })

  it('整段一样吵时也给个落在区间内的值', () => {
    const sr = 1000
    const samples = new Float32Array(sr * 2).fill(0.3)
    const t = findQuietestSec(samples, sr, 0.2, 1.0)
    expect(t).toBeGreaterThan(0.2)
    expect(t).toBeLessThan(1.0)
  })

  it('空采样不炸', () => {
    expect(findQuietestSec(new Float32Array(0), 8000, 0, 1)).toBe(0.5)
  })
})
