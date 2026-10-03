import { describe, it, expect } from 'vitest'
import { applyLanguage, buildLanguagePrompt, parseLanguage } from './language'
import type { Sentence } from '../types/document'

function sentence(id: string, text = 'Hello.'): Sentence {
  return {
    id,
    paraId: 'p01',
    text,
    audio: null,
    translation: null,
    grammarNote: null,
    collocations: [],
    vocab: [],
    tags: [],
    reviewState: { ease: 2.5, due: null, interval: 0, repetitions: 0 },
  }
}

describe('buildLanguagePrompt', () => {
  it('含句 id 与 JSON schema', () => {
    const p = buildLanguagePrompt([{ id: 's001', text: 'The quick fox.' }])
    expect(p).toContain('s001 | The quick fox.')
    expect(p).toContain('"sentences"')
    expect(p).toContain('structure')
    expect(p).toContain('idioms')
  })
})

describe('parseLanguage', () => {
  it('解析合法 JSON（含栅欄）', () => {
    const raw =
      '```json\n{"sentences":[{"id":"s001","structure":"主谓宾","grammar":"一般过去时","idioms":["break the ice"],"phrases":["a quick fox"],"usage":["fox 指狐狸"]}]}\n```'
    const rows = parseLanguage(raw)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ id: 's001', structure: '主谓宾', grammar: '一般过去时' })
    expect(rows[0].idioms).toEqual(['break the ice'])
  })
  it('丢弃没有 id 或全空的项', () => {
    const raw = JSON.stringify({ sentences: [{ structure: 'x' }, { id: 's002' }, { id: 's003', grammar: 'g' }] })
    const rows = parseLanguage(raw)
    expect(rows.map((r) => r.id)).toEqual(['s003'])
  })
  it('非法 JSON → 空', () => {
    expect(parseLanguage('nope')).toEqual([])
  })
})

describe('applyLanguage', () => {
  it('按 id 写回，未命中的不动', () => {
    const sents = [sentence('s001'), sentence('s002', 'Other.')]
    const out = applyLanguage(sents, [{ id: 's001', structure: '主谓', phrases: ['a b'] }])
    expect(out[0].language).toMatchObject({ structure: '主谓', phrases: ['a b'] })
    expect(out[1].language).toBeUndefined()
  })
})
