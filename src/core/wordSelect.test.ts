import { describe, it, expect } from 'vitest'
import { snapSelection, toggleIndex, wordSpans, wordsAtIndex } from './wordSelect'

const S = 'abandon back check deaf ear fish'
//          0      7    12    18   22  26

describe('wordSpans', () => {
  it('切出所有词，标点空白不算', () => {
    expect(wordSpans(S).map((w) => w.text)).toEqual(['abandon', 'back', 'check', 'deaf', 'ear', 'fish'])
  })
  it('连字符复合词并成一个词', () => {
    expect(wordSpans('bad-tempered burqa-clad').map((w) => w.text)).toEqual(['bad-tempered', 'burqa-clad'])
    expect(wordSpans('well-known word, end.')).toEqual([
      { start: 0, end: 10, text: 'well-known' },
      { start: 11, end: 15, text: 'word' },
      { start: 17, end: 20, text: 'end' },
    ])
  })
  it('带空格的连字符 / 破折号不并', () => {
    expect(wordSpans('a - b').map((w) => w.text)).toEqual(['a', 'b'])
    expect(wordSpans('a — b').map((w) => w.text)).toEqual(['a', 'b'])
  })
})

describe('snapSelection', () => {
  it('落在单个词里 → 那个整词', () => {
    expect(snapSelection(S, 2, 5)?.text).toBe('abandon')
  })
  it('光标（起止相同）→ 所在整词', () => {
    expect(snapSelection(S, 3, 3)?.text).toBe('abandon')
  })
  it('拖过 back 的任意位置 → abandon back（碰到 b 也算）', () => {
    expect(snapSelection(S, 0, 9)?.text).toBe('abandon back')
    expect(snapSelection(S, 0, 12)?.text).toBe('abandon back')
  })
  it('只到 back 词边界之前 → 仍是 abandon', () => {
    expect(snapSelection(S, 0, 8)?.text).toBe('abandon')
  })
  it('拖到 deaf 就含 check / deaf（中间全包）', () => {
    expect(snapSelection(S, 0, 21)?.text).toBe('abandon back check deaf')
  })
  it('起点终点反着选也一样', () => {
    expect(snapSelection(S, 12, 0)?.text).toBe('abandon back')
  })
  it('没有词返回 null', () => {
    expect(snapSelection('  , . !  ', 2, 4)).toBeNull()
  })
  it('返回的 start/end 是整词边界', () => {
    const s = snapSelection(S, 1, 9)!
    expect(S.slice(s.start, s.end)).toBe(s.text)
    expect(s.start).toBe(0)
    expect(s.end).toBe(12)
  })
})

describe('snapSelection 连字符复合词', () => {
  const t = 'a bad-tempered man'
  it('落在复合词任意位置都整个选中', () => {
    expect(snapSelection(t, 3, 3)?.text).toBe('bad-tempered')
    expect(snapSelection(t, 10, 10)?.text).toBe('bad-tempered')
    expect(snapSelection(t, 2, 13)?.text).toBe('bad-tempered')
  })
})

describe('toggleIndex / wordsAtIndex（按位置而非词形选中）', () => {
  const text = 'a big something makes a terrible'
  const spans = wordSpans(text)
  // a(0) big(1) something(2) makes(3) a(4) terrible(5)

  it('同一个词的不同位置互不影响', () => {
    // 选中第二个 a（下标 4）→ 只有它被选，第一个 a（下标 0）不受影响
    const sel = toggleIndex([], 4)
    expect(sel).toEqual([4])
    expect(wordsAtIndex(spans, sel)).toEqual(['a'])
  })

  it('按位置切换：选中/取消各自的词', () => {
    let sel = toggleIndex([], 0) // 第一个 a
    sel = toggleIndex(sel, 5) // terrible
    expect(wordsAtIndex(spans, sel)).toEqual(['a', 'terrible'])
    sel = toggleIndex(sel, 0) // 取消第一个 a
    expect(wordsAtIndex(spans, sel)).toEqual(['terrible'])
  })

  it('合成词组带上各自位置的词，不会把同形词都算进来', () => {
    // 选第二个 a + terrible → "a terrible"（而不是 "a a terrible"）
    const sel = [5, 4]
    expect(wordsAtIndex(spans, sel).join(' ')).toBe('a terrible')
  })

  it('下标越界不产生空串', () => {
    expect(wordsAtIndex(spans, [99, 1])).toEqual(['big'])
  })
})
