import { describe, it, expect } from 'vitest'
import { resolveTakeChunk } from './takeChunk'
import type { Chunk, Take } from './ports'

const ch = (start: number, end: number, index: number): Chunk => ({ index, start, end })

function take(patch: Partial<Take> = {}): Take {
  return {
    id: 't1',
    fileName: 'a.mp3',
    chunkIndex: 0,
    blob: new Blob(['x']),
    mimeType: 'audio/webm',
    durationSec: 1,
    createdAt: 1,
    ...patch,
  }
}

const CHUNKS = [ch(0, 1, 0), ch(1.5, 2.5, 1), ch(3, 4, 2)]

describe('resolveTakeChunk', () => {
  it('按录音起点的时间找块，不管存的块号是多少', () => {
    // 存的是块号 0，但时间 3.2s 落在第 3 块
    expect(resolveTakeChunk(take({ chunkIndex: 0, startSec: 3.2, endSec: 4 }), CHUNKS)).toBe(2)
  })

  it('换档位导致块数变少，靠时间仍然挂对', () => {
    // 合并档下这块是 [0, 4]
    const merged = [ch(0, 4, 0)]
    expect(resolveTakeChunk(take({ chunkIndex: 2, startSec: 3.2, endSec: 4 }), merged)).toBe(0)
  })

  it('起点正好在块尾，归到下一块', () => {
    expect(resolveTakeChunk(take({ startSec: 2.5, endSec: 3 }), CHUNKS)).toBe(2)
  })

  it('起点在所有块之后，取最后一块', () => {
    expect(resolveTakeChunk(take({ startSec: 99 }), CHUNKS)).toBe(2)
  })

  it('长块被撕开后，录音留在前半块', () => {
    const split = [ch(0, 1, 0), ch(1, 2, 1), ch(2, 3, 2), ch(3, 4, 3)]
    expect(resolveTakeChunk(take({ startSec: 1, endSec: 3 }), split)).toBe(1)
  })

  it('老记录没有 startSec 时沿用块号', () => {
    expect(resolveTakeChunk(take({ chunkIndex: 1 }), CHUNKS)).toBe(1)
  })

  it('老记录的块号越界时夹进合法范围', () => {
    expect(resolveTakeChunk(take({ chunkIndex: 99 }), CHUNKS)).toBe(2)
    expect(resolveTakeChunk(take({ chunkIndex: -5 }), CHUNKS)).toBe(0)
  })

  it('没有块时不炸', () => {
    expect(resolveTakeChunk(take({ startSec: 1 }), [])).toBe(0)
  })
})
