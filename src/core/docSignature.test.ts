import { describe, expect, it } from 'vitest'
import { docSignature } from './docSignature'
import type { Sentence } from '../types/document'

const S = (text: string): Sentence => ({
  id: 's1',
  paraId: 'p01',
  text,
  audio: null,
  translation: null,
  grammarNote: null,
  collocations: [],
  vocab: [],
  tags: [],
  reviewState: { ease: 2.5, due: null, interval: 0, repetitions: 0 },
})

/**
 * 正文签名：给「按文章记住点什么」的地方当键的一部分。
 * 要求：同正文同签名（能续上）、不同正文不同签名（不串篇）。
 */
describe('docSignature', () => {
  it('同样的正文 → 同样的签名（同一篇重开能续上）', () => {
    expect(docSignature([S('Run fast.'), S('Walk slow.')])).toBe(docSignature([S('Run fast.'), S('Walk slow.')]))
  })

  it('不同正文 → 不同签名（同名文章也不会共用一份状态）', () => {
    expect(docSignature([S('Run fast.')])).not.toBe(docSignature([S('Walk slow.')]))
  })

  it('句子切分不同 → 签名也不同（句间有分隔，ab|c ≠ a|bc）', () => {
    expect(docSignature([S('ab'), S('c')])).not.toBe(docSignature([S('a'), S('bc')]))
  })

  it('空正文有稳定的签名（不是 NaN / undefined），且能当键用', () => {
    expect(docSignature([])).toBe(docSignature([]))
    expect(docSignature([])).toMatch(/^[0-9a-z]+$/)
  })

  it('长短文都落在 36 进制小写字母数字里（别出现负号）', () => {
    expect(docSignature([S('The quick brown fox jumps over the lazy dog.')])).toMatch(/^[0-9a-z]+$/)
  })
})
