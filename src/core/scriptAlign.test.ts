import { describe, it, expect } from 'vitest'
import { alignScript, resolveScriptAnchors, scriptWords } from './scriptAlign'
import type { Chunk, ManualAnchor } from './ports'

/** 三块，各 1 秒 —— 比例摊词时每块词数好算 */
const CHUNKS: Chunk[] = [
  { index: 0, start: 0, end: 1 },
  { index: 1, start: 1, end: 2 },
  { index: 2, start: 2, end: 3 },
]

const SCRIPT = 'one two three four five six'

const texts = (r: { text: string }[]) => r.map((a) => a.text)

describe('scriptWords', () => {
  it('按空白切词，前后空格不算词', () => {
    expect(scriptWords('  one   two\n three ')).toEqual(['one', 'two', 'three'])
  })

  it('空文本没有词', () => {
    expect(scriptWords('')).toEqual([])
    expect(scriptWords('  \n\t ')).toEqual([])
  })
})

describe('alignScript', () => {
  it('没文本就是空 —— 界面按「还没粘原文」显示', () => {
    expect(alignScript({ script: '', chunks: CHUNKS })).toEqual([])
    expect(alignScript({ script: '   ', chunks: CHUNKS })).toEqual([])
  })

  it('没文本也没块时不崩', () => {
    expect(alignScript({ script: '', chunks: [] })).toEqual([])
  })

  it('按块时长比例摊：长度相等就均分，且一个词不丢', () => {
    const r = alignScript({ script: SCRIPT, chunks: CHUNKS })
    expect(texts(r)).toEqual(['one two', 'three four', 'five six'])
    expect(r.map((a) => a.wordRange)).toEqual([
      [0, 2],
      [2, 4],
      [4, 6],
    ])
  })

  it('正文起点：前面几块留空，词全给后面的块', () => {
    const r = alignScript({ script: SCRIPT, chunks: CHUNKS, textStartChunk: 1 })
    expect(texts(r)[0]).toBe('')
    expect(r[0].wordRange).toEqual([0, 0])
    // 剩下的词在两个块里均分，总数不变
    expect(r[1].text.split(' ').length + r[2].text.split(' ').length).toBe(6)
    expect(r.map((a) => a.text).join(' ').trim()).toBe(SCRIPT)
  })

  it('正文起点越界时夹进块范围（不会整篇空掉）', () => {
    const r = alignScript({ script: SCRIPT, chunks: CHUNKS, textStartChunk: 99 })
    expect(texts(r).slice(0, 2)).toEqual(['', ''])
    expect(r[2].text).toBe(SCRIPT)
  })

  it('文字偏移整体往前赶：词窗平移，末块被夹回结尾', () => {
    const r = alignScript({ script: SCRIPT, chunks: CHUNKS, offsetWords: 2 })
    // 平移后第一块的窗口变大，词序仍然完整
    expect(r[0].wordRange[1]).toBeGreaterThan(2)
    expect(r.map((a) => a.text).join(' ').trim().split(/\s+/)).toEqual(SCRIPT.split(' '))
  })

  it('有手动锚点时以锚点为准，偏移让位', () => {
    const anchors: ManualAnchor[] = [{ atSec: 0, startWord: 0, endWord: 1, text: 'one' }]
    const r = alignScript({ script: SCRIPT, chunks: CHUNKS, anchors, offsetWords: 2, textStartChunk: 1 })
    expect(r[0].anchored).toBe(true)
    expect(r[0].text).toBe('one')
    // 锚点之外照旧按比例摊，词序完整
    expect(texts(r).join(' ').trim()).toBe(SCRIPT)
  })

  it('锚点解析不出来（空词范围）时退回按比例摊（不会整篇空白）', () => {
    const anchors: ManualAnchor[] = [{ atSec: 0, startWord: 3, endWord: 3 }]
    const r = alignScript({ script: SCRIPT, chunks: CHUNKS, anchors })
    expect(r.every((a) => !a.anchored)).toBe(true)
    expect(texts(r).join(' ').trim()).toBe(SCRIPT)
  })
})

describe('resolveScriptAnchors', () => {
  const anchors: ManualAnchor[] = [{ atSec: 1.2, startWord: 2, endWord: 4, text: 'three four' }]

  it('没锚点时为空的（界面显示「未锚定」）', () => {
    expect(resolveScriptAnchors({ script: SCRIPT, chunks: CHUNKS })).toEqual([])
    expect(resolveScriptAnchors({ script: SCRIPT, chunks: CHUNKS, anchors: [] })).toEqual([])
  })

  it('没块 / 没文本时也为空', () => {
    expect(resolveScriptAnchors({ script: SCRIPT, chunks: [], anchors })).toEqual([])
    expect(resolveScriptAnchors({ script: '', chunks: CHUNKS, anchors })).toEqual([])
  })

  it('锚点落到「按音频时间算出」的块上', () => {
    const r = resolveScriptAnchors({ script: SCRIPT, chunks: CHUNKS, anchors })
    expect(r).toEqual([{ atSec: 1.2, chunkIndex: 1, startWord: 2, endWord: 4 }])
  })
})
