import { describe, expect, it } from 'vitest'
import {
  buildGoldenAssembly,
  buildGoldenCloze,
  buildGoldenFillRounds,
  checkGoldenAssembly,
  checkGoldenFill,
  checkGoldenRecall,
} from './goldenDrill'

describe('golden cloze / assembly / recall', () => {
  const text = 'In response to the pandemic, remote collaboration has become the new norm.'
  const targets = [
    { en: 'in response to', zh: '为了应对', kind: 'collocation' as const },
    { en: 'remote collaboration', zh: '远程协作', kind: 'collocation' as const },
    { en: 'has become', zh: '已经成为', kind: 'tense' as const },
  ]

  it('默认按语言点整块挖；同一目标重复出现共用一个空', () => {
    const cloze = buildGoldenCloze('In response to this, in response to that.', [
      { en: 'in response to', kind: 'collocation' },
    ])
    expect(cloze?.blanks).toHaveLength(1)
    expect(cloze?.parts.filter((p) => p.blank)).toHaveLength(2)
  })

  it('按词拆：for every day = 3 个空；大小写不敏感', () => {
    const cloze = buildGoldenCloze('We practice for every day.', [
      { en: 'for every day', zh: '每一天', kind: 'collocation' },
    ], { splitWords: true })
    expect(cloze?.blanks.map((b) => b.answer)).toEqual(['for', 'every', 'day'])
    expect(cloze?.blanks.map((b) => b.index)).toEqual([1, 2, 3])
    expect(cloze?.blanks[0].hint).toBe('每一天')
    expect(cloze?.blanks[1].hint).toBeUndefined()
    expect(checkGoldenFill(cloze!, ['FOR', 'Every', 'DAY'])).toEqual([true, true, true])
  })

  it('细碎轮次：keep up with → with → up with → keep up with', () => {
    const rounds = buildGoldenFillRounds('We should keep up with the news.', [
      { en: 'keep up with', zh: '跟上', kind: 'idiom' },
    ])
    expect(rounds.map((r) => r.cloze.blanks.map((b) => b.answer).join(' '))).toEqual([
      'with',
      'up with',
      'keep up with',
    ])
  })

  it('按词拆时重复目标共用同一组空', () => {
    const cloze = buildGoldenCloze('Day by day, day by day.', [
      { en: 'day by day', kind: 'idiom' },
    ], { splitWords: true })
    expect(cloze?.blanks).toHaveLength(3)
    expect(cloze?.parts.filter((p) => p.blank).length).toBe(6)
  })

  it('填空判分忽略大小写/标点；拼句按顺序', () => {
    const cloze = buildGoldenCloze(text, targets)
    expect(cloze).not.toBeNull()
    if (!cloze) return
    expect(checkGoldenFill(cloze, ['In response to', 'remote collaboration', 'has become'])).toEqual([true, true, true])
    expect(checkGoldenFill(cloze, ['response to', 'remote collaboration', 'has become'])).toEqual([false, true, true])
    const bank = buildGoldenAssembly(text, targets)
    expect(bank).not.toBeNull()
    if (!bank) return
    expect(checkGoldenAssembly(bank.cloze.targets, bank.cloze.targets.map((t) => t.en))).toBe(true)
    expect(checkGoldenAssembly(bank.cloze.targets, ['has become', 'remote collaboration', 'in response to'])).toBe(false)
    expect(buildGoldenAssembly(text, targets)?.bank).toEqual(bank.bank)
  })

  it('逆向默写：exact/near 算首次正确，loose 不算', () => {
    expect(checkGoldenRecall(text, text).firstOk).toBe(true)
    expect(checkGoldenRecall('In response to the pandemic, remote collaboration has become the new norm', text).firstOk).toBe(true)
    expect(checkGoldenRecall('Remote work is popular now.', text).firstOk).toBe(false)
  })
})
