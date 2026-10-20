import { describe, expect, it } from 'vitest'
import { pickSentence, pickTarget } from './pickTarget'
import type { Sentence } from '../types/document'

const S = (id: string, text: string) => ({ id, text }) as Sentence
const sentences = [S('s1', 'Hello there.'), S('s2', 'A quiet morning in Kyoto.')]

describe('pickSentence', () => {
  it('显式选中的句子优先', () => {
    expect(pickSentence(sentences, 's2', 'Hello')?.id).toBe('s2')
  })

  it('没选中就用精确选区去匹配包含它的句子', () => {
    expect(pickSentence(sentences, null, 'quiet')?.id).toBe('s2')
  })

  it('选中的 id 不存在时退回按选区匹配（文章换过也不会崩）', () => {
    expect(pickSentence(sentences, 'gone', 'Hello')?.id).toBe('s1')
  })

  it('什么都没有 → null', () => {
    expect(pickSentence(sentences, null, '')).toBeNull()
    expect(pickSentence(sentences, 'nope', 'zzz')).toBeNull()
  })

  it('句子没加载（null）→ null，不抛', () => {
    expect(pickSentence(null, 's1', 'Hello')).toBeNull()
  })
})

describe('pickTarget', () => {
  const s = S('s1', 'Hello there.')

  it('勾了选区且有选区 → 用选区', () => {
    expect(pickTarget('there', true, s)).toBe('there')
  })

  it('勾了但选区是空的 → 退回整句', () => {
    expect(pickTarget('', true, s)).toBe('Hello there.')
  })

  it('没勾 → 整句', () => {
    expect(pickTarget('there', false, s)).toBe('Hello there.')
  })

  it('没有句子 → 退回选区（散词也能拷）', () => {
    expect(pickTarget('there', true, null)).toBe('there')
    expect(pickTarget('', false, null)).toBe('')
  })
})
