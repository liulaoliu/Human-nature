import { describe, it, expect } from 'vitest'
import { snapSelection, wordSpans } from './wordSelect'

const S = 'abandon back check deaf ear fish'
//          0      7    12    18   22  26

describe('wordSpans', () => {
  it('切出所有词，标点空白不算（连字符词按两段，跨选时中间连字符会带上）', () => {
    expect(wordSpans(S).map((w) => w.text)).toEqual(['abandon', 'back', 'check', 'deaf', 'ear', 'fish'])
    expect(wordSpans('well-known word, end.')).toEqual([
      { start: 0, end: 4, text: 'well' },
      { start: 5, end: 10, text: 'known' },
      { start: 11, end: 15, text: 'word' },
      { start: 17, end: 20, text: 'end' },
    ])
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
