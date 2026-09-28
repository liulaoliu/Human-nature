import { describe, it, expect } from 'vitest'
import { alignTextToChunks, alignTextToChunksWithAnchors, resolveAnchors } from './alignText'
import type { Chunk, ManualAnchor } from './ports'

const chunks = (...spec: Array<[number, number]>): Chunk[] =>
  spec.map(([start, end], index) => ({ index, start, end }))

const TEXT =
  'The Kenyan government has a problem. Its banks will not lend cheaply to the private sector. ' +
  'Tired of asking nicely, the government has taken matters into its own hands. This month it ' +
  'will put a cap on commercial banks interest rates: charging borrowers more than four ' +
  'percentage points above the central bank base rate will be illegal. Shares plummeted by 10%.'

describe('alignTextToChunks', () => {
  it('空文本时每块都是空串', () => {
    const r = alignTextToChunks('   ', chunks([0, 5], [5, 10]))
    expect(r).toHaveLength(2)
    expect(r.every((c) => c.text === '')).toBe(true)
  })

  it('没有块时返回空数组', () => {
    expect(alignTextToChunks('hello world', [])).toEqual([])
  })

  it('单块时拿到全部文本', () => {
    const r = alignTextToChunks(TEXT, chunks([0, 10]))
    expect(r[0].text).toBe(TEXT)
  })

  it('把所有块拼起来能还原原始词序，不丢词也不重复', () => {
    const cs = chunks([0, 3], [3, 7], [7, 9], [9, 14])
    const r = alignTextToChunks(TEXT, cs)
    const rejoined = r.map((c) => c.text).join(' ').split(/\s+/).filter(Boolean)
    expect(rejoined).toEqual(TEXT.split(/\s+/).filter(Boolean))
  })

  it('按时长比例分配词数：长块拿到的词明显更多', () => {
    // 第 1 块 1 秒，第 2 块 9 秒
    const r = alignTextToChunks(TEXT, chunks([0, 1], [1, 10]))
    const w = TEXT.split(/\s+/).filter(Boolean).length
    const first = r[0].text ? r[0].text.split(/\s+/).length : 0
    expect(r[1].text.split(/\s+/).length).toBeGreaterThan(first * 3)
    expect(first + r[1].text.split(/\s+/).length).toBe(w)
  })

  it('没有句号可吸附时，严格按比例切', () => {
    const flat = 'a b c d e f g h i j k l' // 12 词，无任何句末标点
    const r = alignTextToChunks(flat, chunks([0, 5], [5, 10], [10, 15]))
    expect(r.map((c) => c.text.split(' ').length)).toEqual([4, 4, 4])
  })

  it('边界尽量落在句末', () => {
    const r = alignTextToChunks(TEXT, chunks([0, 2], [2, 8], [8, 14]))
    // 第一块应该以一个完整的句子收尾
    expect(r[0].text).toMatch(/[.!?]["']?$/)
  })

  it('句子吸附不会导致某块拿到零词（除非总词数就那么多少）', () => {
    const r = alignTextToChunks(TEXT, chunks([0, 1], [1, 2], [2, 3], [3, 14]))
    expect(r.slice(0, 3).every((c) => c.text.length > 0)).toBe(true)
  })

  it('词数少于块数时不报错，后面几块留空', () => {
    const r = alignTextToChunks('one two', chunks([0, 1], [1, 2], [2, 3]))
    expect(r).toHaveLength(3)
    expect(r[0].text).not.toBe('')
    expect(r[2].text).toBe('')
  })

  it('保留括号引号里的句号不误切', () => {
    const t = 'The U.S. economy grew (see page 4. Note this). Analysts agreed. Growth continued.'
    const r = alignTextToChunks(t, chunks([0, 5], [5, 10]))
    // 理想切点落在 4. 附近，但不能切在那儿——括号还没闭合
    expect(r[0].text).toMatch(/this\)\.$/)
    // 也不能切在 "U.S." 后面，因为下一句不是大写开头
    expect(r[0].text).not.toMatch(/U\.S\.$/)
  })

  it('忽略多余空白和换行', () => {
    const messy = '  The   Kenyan\n\n  government   has   a   problem.  '
    const r = alignTextToChunks(messy, chunks([0, 5], [5, 10]))
    expect(r.map((c) => c.text).filter(Boolean).join(' ')).toBe('The Kenyan government has a problem.')
  })

  it('每块带上起止词序号，方便定位', () => {
    const r = alignTextToChunks(TEXT, chunks([0, 5], [5, 14]))
    expect(r[0].wordRange).toEqual([0, r[0].text.split(/\s+/).length])
    expect(r[1].wordRange[0]).toBe(r[0].wordRange[1])
  })

  it('最后一块一定收完所有词', () => {
    const r = alignTextToChunks(TEXT, chunks([0, 1], [1, 2], [2, 14]))
    const last = r[r.length - 1]
    expect(last.wordRange[1]).toBe(TEXT.split(/\s+/).filter(Boolean).length)
  })

  it('不按比例也能对齐：块时长全为 0 时不崩', () => {
    const r = alignTextToChunks(TEXT, chunks([3, 3], [3, 3]))
    expect(r.map((c) => c.text)).toEqual(['', ''])
  })
})

describe('整体平移 offsetWords', () => {
  // 10 块，每块等长，共 40 词 → 不偏移时每块 4 词
  const CH = Array.from({ length: 10 }, (_, i) => [i, i + 1] as [number, number])
  const words = Array.from({ length: 40 }, (_, i) => `w${i}`)
  const T = words.join(' ') + '.'

  const join = (r: { text: string }[]) =>
    r.map((c) => c.text).join(' ').split(/\s+/).filter(Boolean)

  it('不传平移量时和不加这个参数时一模一样', () => {
    expect(alignTextToChunks(T, chunks(...CH))).toEqual(
      alignTextToChunks(T, chunks(...CH), 0),
    )
  })

  it('平移后仍然「拼起来等于原文」，一个词不丢不重', () => {
    for (const off of [-30, -7, -1, 0, 1, 7, 30]) {
      const r = alignTextToChunks(T, chunks(...CH), off)
      expect(join(r), `offset=${off}`).toEqual(T.split(/\s+/).filter(Boolean))
    }
  })

  it('正的平移把词窗往后推：第一块拿到更多词', () => {
    const base = alignTextToChunks(T, chunks(...CH), 0)[0]
    const up = alignTextToChunks(T, chunks(...CH), 8)[0]
    expect(up.wordRange[1]).toBe(base.wordRange[1] + 8)
  })

  it('负的平移把词窗往前拉：第一块被压到最薄但不为空', () => {
    const r = alignTextToChunks(T, chunks(...CH), -20)
    expect(r[0].wordRange[0]).toBe(0)
    expect(r[0].wordRange[1]).toBeGreaterThan(0)
    // 中间的块确实跟着往前挪了
    expect(r[5].wordRange[0]).toBeLessThan(
      alignTextToChunks(T, chunks(...CH), 0)[5].wordRange[0],
    )
  })

  it('词序号始终单调不减、不出界', () => {
    for (const off of [-99, -13, 0, 13, 99]) {
      const r = alignTextToChunks(T, chunks(...CH), off)
      let prev = 0
      for (const c of r) {
        expect(c.wordRange[0], `offset=${off}`).toBeGreaterThanOrEqual(prev)
        expect(c.wordRange[1]).toBeGreaterThanOrEqual(c.wordRange[0])
        expect(c.wordRange[1]).toBeLessThanOrEqual(40)
        prev = c.wordRange[1]
      }
      expect(r[r.length - 1].wordRange[1]).toBe(40)
    }
  })

  it('平移量超过总词数也不丢词（全挤到首尾块）', () => {
    const big = alignTextToChunks(T, chunks(...CH), 999)
    expect(join(big)).toEqual(T.split(/\s+/).filter(Boolean))
    expect(big[big.length - 1].wordRange[1]).toBe(40)
  })
})

describe('alignTextToChunksWithAnchors', () => {
  const join = (r: { text: string }[]) =>
    r.map((c) => c.text).join(' ').split(/\s+/).filter(Boolean)
  const words = Array.from({ length: 40 }, (_, i) => `w${i}`)
  const T = words.join(' ') + '.'
  const TOTAL = T.split(/\s+/).filter(Boolean).length
  const CH = chunks(...Array.from({ length: 10 }, (_, i) => [i, i + 1] as [number, number]))

  it('没有锚点时和纯比例对齐一致', () => {
    expect(alignTextToChunksWithAnchors(T, CH, [])).toEqual(alignTextToChunks(T, CH, 0))
  })

  it('中间一块锚定后，那一块刚好是选中的词，拼回来还是原文', () => {
    const a: ManualAnchor = { atSec: 4.5, startWord: 16, endWord: 20 }
    const r = alignTextToChunksWithAnchors(T, CH, [a])
    expect(r[4].wordRange).toEqual([16, 20])
    expect(join(r)).toEqual(T.split(/\s+/).filter(Boolean))
  })

  it('多个锚点都生效，中间按比例摊', () => {
    const r = alignTextToChunksWithAnchors(T, CH, [
      { atSec: 2.5, startWord: 8, endWord: 12 },
      { atSec: 7.5, startWord: 30, endWord: 34 },
    ])
    expect(r[2].wordRange).toEqual([8, 12])
    expect(r[7].wordRange).toEqual([30, 34])
    expect(join(r)).toEqual(T.split(/\s+/).filter(Boolean))
  })

  it('锚点顺带把正文起点定了：前面的块留空', () => {
    const r = alignTextToChunksWithAnchors(T, CH, [{ atSec: 3.5, startWord: 0, endWord: 5 }])
    expect(r[0].text).toBe('')
    expect(r[2].text).toBe('')
    expect(r[3].wordRange).toEqual([0, 5])
    expect(join(r)).toEqual(T.split(/\s+/).filter(Boolean))
  })

  it('重叠的锚点靠前的赢，不丢词不重复', () => {
    const r = alignTextToChunksWithAnchors(T, CH, [
      { atSec: 1.5, startWord: 4, endWord: 12 },
      { atSec: 2.5, startWord: 8, endWord: 16 },
    ])
    expect(r[1].wordRange).toEqual([4, 12])
    expect(r[2].wordRange[0]).toBeGreaterThanOrEqual(12)
    expect(join(r)).toEqual(T.split(/\s+/).filter(Boolean))
  })

  it('按时间认块：换切块粒度后锚点还认得原来那段音频', () => {
    const coarse = chunks([0, 4], [4, 8], [8, 12])
    const fine = chunks([0, 2], [2, 4], [4, 6], [6, 8], [8, 10], [10, 12])
    const a: ManualAnchor = { atSec: 4.5, startWord: 0, endWord: 6 }
    expect(alignTextToChunksWithAnchors(T, fine, [a])[2].wordRange).toEqual([0, 6])
    expect(alignTextToChunksWithAnchors(T, coarse, [a])[1].wordRange).toEqual([0, 6])
  })

  it('词序号单调不出界，末尾收完', () => {
    const r = alignTextToChunksWithAnchors(T, CH, [
      { atSec: 0.5, startWord: 0, endWord: 3 },
      { atSec: 9.5, startWord: 35, endWord: TOTAL },
    ])
    let prev = 0
    for (const c of r) {
      expect(c.wordRange[0]).toBeGreaterThanOrEqual(prev)
      expect(c.wordRange[1]).toBeGreaterThanOrEqual(c.wordRange[0])
      prev = c.wordRange[1]
    }
    expect(r[r.length - 1].wordRange[1]).toBe(TOTAL)
    expect(join(r)).toEqual(T.split(/\s+/).filter(Boolean))
  })

  it('钉过的块带 anchored 标记，没钉的没有', () => {
    const r = alignTextToChunksWithAnchors(T, CH, [{ atSec: 4.5, startWord: 16, endWord: 20 }])
    expect(r[4].anchored).toBe(true)
    expect(r[3].anchored).toBeUndefined()
    expect(r[5].anchored).toBeUndefined()
  })

  it('改别处的文字后，带 text 的锚点能在新词表里找回原位置', () => {
    // 原锚点钉在第 5 块，读 w16..w19
    const anchor: ManualAnchor = {
      atSec: 4.5,
      startWord: 16,
      endWord: 20,
      text: words.slice(16, 20).join(' '),
    }
    // 前面插入 3 个词（相当于删掉了别处一段/补了漏字）
    const edited = ['x', 'y', 'z', ...words].join(' ') + '.'
    const r = alignTextToChunksWithAnchors(edited, CH, [anchor])
    expect(r[4].wordRange).toEqual([19, 23])
  })

  it('text 在新文本里找不到时退回存下的词序号（夹紧）', () => {
    const r = alignTextToChunksWithAnchors(T, CH, [
      { atSec: 4.5, startWord: 16, endWord: 20, text: '这里根本没有这几个词' },
    ])
    expect(r[4].wordRange).toEqual([16, 20])
  })

  it('锚点文字重复出现时，认离原来位置最近的那处', () => {
    const zz = Array.from({ length: 20 }, () => 'zz')
    // "aa bb" 在 0 和 22 都出现，存的顺序号是 22，应该认后面那处
    const dup = ['aa', 'bb', ...zz, 'aa', 'bb', ...zz]
    const cs = chunks([0, 10], [10, 20], [20, 30], [30, 40], [40, 50], [50, 60])
    const r = resolveAnchors(dup, cs, [
      { atSec: 55, startWord: 22, endWord: 24, text: 'aa bb' },
    ])
    expect(r[0].startWord).toBe(22)
    expect(r[0].endWord).toBe(24)
  })
})
