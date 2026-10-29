import { describe, expect, it } from 'vitest'
import { doneLangPoints, langPointChoices, langPointKey } from './goldenLangPoint'
import type { Sentence } from '../types/document'

const S = (over: Partial<Sentence> = {}): Sentence => ({
  id: 's1',
  paraId: 'p01',
  text: 'The iPhone will come with a better camera.',
  audio: null,
  translation: null,
  grammarNote: null,
  collocations: [],
  vocab: [],
  tags: [],
  reviewState: { ease: 2.5, due: null, interval: 0, repetitions: 0 },
  ...over,
})

const withLangs = (phrases: string[], idioms: string[] = []) =>
  S({ languages: [{ phrases, idioms, usage: ['so-called 常带保留态度（中文说明，不该进选块）'] }] })

describe('langPointChoices：本句可单练的词块', () => {
  it('拆「英文 — 中文」，短语 + 习语都收，中文用法不进列表', () => {
    const choices = langPointChoices(withLangs(['come with — 配备，附带', 'much of an improvement — 很大的改进'], ['not much of a — 算不上好的']))
    expect(choices.map((c) => c.en)).toEqual(['come with', 'much of an improvement', 'not much of a'])
    expect(choices.map((c) => c.zh)).toEqual(['配备，附带', '很大的改进', '算不上好的'])
    expect(choices.every((c) => !c.done)).toBe(true)
  })

  it('没有释义的也能用；同句重复只留一条（大小写 / 空白不敏感）', () => {
    const choices = langPointChoices(withLangs(['come  with', 'Come With', 'serve small niches — 服务小众市场']))
    expect(choices.map((c) => c.en)).toEqual(['come  with', 'serve small niches'])
    expect(choices[0].zh).toBeUndefined()
  })

  it('没有语言点 / 空句子 → 空数组', () => {
    expect(langPointChoices(S())).toEqual([])
    expect(langPointChoices(null)).toEqual([])
  })

  it('已练过的打 done', () => {
    const done = new Set([langPointKey('come with')])
    const choices = langPointChoices(withLangs(['come with — 配备', 'serve small niches']), done)
    expect(choices.map((c) => c.done)).toEqual([true, false])
  })
})

describe('doneLangPoints / langPointKey', () => {
  it('只认同篇同句的 focus（别的篇 / 别的句不算）', () => {
    const set = doneLangPoints(
      [
        { articleId: 'a1', sentenceId: 's1', task: { focus: 'come with' } },
        { articleId: 'a1', sentenceId: 's2', task: { focus: 'come with' } },
        { articleId: 'a2', sentenceId: 's1', task: { focus: 'serve' } },
        { articleId: 'a1', sentenceId: 's1', task: {} },
      ],
      'a1',
      's1',
    )
    expect([...set]).toEqual(['come with'])
  })
})
