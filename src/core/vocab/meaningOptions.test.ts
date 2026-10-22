import { describe, expect, it } from 'vitest'
import { correctOptionIndex, meaningOptions } from './meaningOptions'
import type { VocabItem } from '../../types/document'

function item(id: string, meaning: string): VocabItem {
  return {
    id,
    word: id,
    lemma: id,
    phonetic: null,
    partOfSpeech: null,
    meaning,
    usage: [],
    examples: [],
    source: null,
    status: 'queried',
    note: '',
    tags: [],
    reviewState: { ease: 2.5, due: null, interval: 0, repetitions: 0 },
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  } as VocabItem
}

const card = item('a', '放弃')
const others = [item('b', '勇敢'), item('c', '取消'), item('d', '遗弃'), item('e', '抛弃')]

describe('meaningOptions：选中文释义的四个选项', () => {
  it('正确 + 3 个干扰项，共 4 条', () => {
    const opts = meaningOptions(card, [card, ...others])
    expect(opts).toHaveLength(4)
    expect(opts.filter((o) => o.correct)).toHaveLength(1)
    expect(opts.find((o) => o.correct)?.text).toBe('放弃')
  })

  it('干扰项来自别的词，不含正确释义本身', () => {
    const opts = meaningOptions(card, [card, ...others])
    expect(opts.filter((o) => !o.correct).map((o) => o.text)).not.toContain('放弃')
    expect(new Set(opts.map((o) => o.text)).size).toBe(4)
  })

  it('同一张卡顺序稳定（词库增删也不跳位置）', () => {
    const a = meaningOptions(card, [card, ...others]).map((o) => o.text)
    const b = meaningOptions(card, [card, ...others, item('f', '离别')]).map((o) => o.text)
    expect(a).toEqual(b)
  })

  it('正确项下标能取到（学习模式揭示答案要用）', () => {
    const opts = meaningOptions(card, [card, ...others])
    expect(opts[correctOptionIndex(card, [card, ...others])].correct).toBe(true)
  })

  it('词库不足 3 个干扰项 → 出不了题（调用方退回普通卡）', () => {
    expect(meaningOptions(card, [card, item('b', '勇敢')])).toEqual([])
    expect(correctOptionIndex(card, [card, item('b', '勇敢')])).toBe(-1)
  })

  it('没有释义的词也出不了题', () => {
    const noMeaning = { ...card, meaning: null } as VocabItem
    expect(meaningOptions(noMeaning, [noMeaning, ...others])).toEqual([])
  })
})
