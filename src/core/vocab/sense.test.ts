import { describe, expect, it } from 'vitest'
import type { VocabItem } from '../../types/document'
import { posClassOf, posFromGloss, reconcileSense, senseConflict } from './sense'

const item = (patch: Partial<VocabItem>): VocabItem =>
  ({
    id: 'vocab:x',
    word: 'x',
    lemma: 'x',
    phonetic: null,
    partOfSpeech: null,
    meaning: null,
    definition: null,
    usage: [],
    examples: [],
    source: null,
    status: 'queried',
    note: '',
    tags: [],
    reviewState: { ease: 2.5, due: '2026-10-22T00:00:00.000Z', interval: 0, repetitions: 0, relearn: 0 },
    createdAt: '2026-10-22T00:00:00.000Z',
    updatedAt: '2026-10-22T00:00:00.000Z',
    ...patch,
  }) as VocabItem

describe('posClassOf / posFromGloss', () => {
  it('词性归类：缩写、全称、并写', () => {
    expect(posClassOf('n.')).toBe('n')
    expect(posClassOf('noun')).toBe('n')
    expect(posClassOf('vt.')).toBe('v')
    expect(posClassOf('a.')).toBe('adj')
    expect(posClassOf('adv')).toBe('adv')
    expect(posClassOf('n./v.')).toBe('n')
    expect(posClassOf('')).toBe('')
  })

  it('释义开头的词性标记', () => {
    expect(posFromGloss('n. 誓约, 誓言')).toBe('n.')
    expect(posFromGloss('vt. 引起, 触发')).toBe('v.')
    expect(posFromGloss('a. 微小的')).toBe('adj.')
    expect(posFromGloss('与……匹敌')).toBeNull()
    expect(posFromGloss('a word or phrase')).toBeNull()
    expect(posFromGloss('')).toBeNull()
  })
})

describe('reconcileSense', () => {
  it('释义带着词性标记时，词性跟它走（v. 却写着 n. 的释义 → 改回 n.）', () => {
    const out = reconcileSense(
      item({ partOfSpeech: 'v.', meaning: 'n. 誓约, 誓言', fieldSources: { partOfSpeech: 'ai', meaning: 'dict' } }),
    )
    expect(out.partOfSpeech).toBe('n.')
    expect(out.fieldSources?.partOfSpeech).toBe('dict')
  })

  it('释义标记与词性一致时原样返回（同一个引用，调用方据此跳过写库）', () => {
    const cur = item({ partOfSpeech: 'n.', meaning: 'n. 誓约', fieldSources: { partOfSpeech: 'ai', meaning: 'ai' } })
    expect(reconcileSense(cur)).toBe(cur)
  })

  it('释义没带标记就不猜（词性为空也不硬凑）', () => {
    const cur = item({ partOfSpeech: 'n.', meaning: '与……匹敌' })
    expect(reconcileSense(cur)).toBe(cur)
  })

  it('用户手填的词性不动', () => {
    const cur = item({ partOfSpeech: 'v.', meaning: 'n. 誓约', fieldSources: { partOfSpeech: 'manual', meaning: 'dict' } })
    expect(reconcileSense(cur)).toBe(cur)
  })
})

describe('senseConflict', () => {
  it('词典占位词性 + AI 语境释义 → 报出来', () => {
    expect(
      senseConflict(item({ partOfSpeech: 'n.', meaning: '与……匹敌', fieldSources: { partOfSpeech: 'dict', meaning: 'ai' } })),
    ).toBe('dict-pos-with-ai-meaning')
  })

  it('词性与释义首标打架 → 报出来', () => {
    expect(senseConflict(item({ partOfSpeech: 'v.', meaning: 'n. 誓约' }))).toBe('pos-gloss-mismatch')
  })

  it('AI 同时给词性和释义（同一行答案）不算冲突', () => {
    expect(
      senseConflict(item({ partOfSpeech: 'v.', meaning: '与……匹敌', fieldSources: { partOfSpeech: 'ai', meaning: 'ai' } })),
    ).toBeNull()
  })
})
