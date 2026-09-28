import { describe, it, expect } from 'vitest'
import { alignTextToChunks } from './alignText'
import type { Chunk } from './ports'

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
