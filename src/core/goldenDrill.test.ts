import { describe, expect, it } from 'vitest'
import {
  buildGoldenAssembly,
  buildGoldenCloze,
  buildGoldenFillPlan,
  buildGoldenFillRounds,
  buildGoldenSentenceFillRounds,
  checkGoldenAssembly,
  checkGoldenFill,
  checkGoldenRecall,
  goldenClozeKey,
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

  it('整句渐进：一个词 → 全部目标词 → 整句', () => {
    const rounds = buildGoldenSentenceFillRounds('We should keep up with the news.', [
      { en: 'keep up with', zh: '跟上', kind: 'idiom' },
    ])
    expect(rounds.map((r) => r.cloze.blanks.map((b) => b.answer).join(' '))).toEqual([
      'with',
      'keep up with',
      'We should keep up with the news',
    ])
    expect(rounds.every((r) => r.scope === 'sentence')).toBe(true)
  })

  it('整句渐进：释义只挂在目标首词，不把第一个语言点的释义贴到无关空', () => {
    const rounds = buildGoldenSentenceFillRounds('We should keep up with the news.', [
      { en: 'keep up with', zh: '跟上', kind: 'idiom' },
      { en: 'the news', zh: '新闻', kind: 'collocation' },
    ])
    const last = rounds.at(-1)!.cloze
    const hintOf = new Map(last.blanks.map((b) => [b.answer, b.hint]))
    expect(hintOf.get('keep')).toBe('跟上')
    expect(hintOf.get('the')).toBe('新闻')
    expect(hintOf.get('We')).toBeUndefined()
    expect(hintOf.get('should')).toBeUndefined()
    expect(hintOf.get('up')).toBeUndefined()
    expect(hintOf.get('with')).toBeUndefined()
    expect(hintOf.get('news')).toBeUndefined()
  })

  it('填空计划：target 模式 + 关闭整句只留语言点轮', () => {
    const rounds = buildGoldenFillPlan(text, targets, { blankUnit: 'target', sentenceFill: false })
    expect(rounds).toHaveLength(1)
    expect(rounds[0].scope).toBe('target')
    expect(rounds[0].cloze.blanks).toHaveLength(targets.length)
  })

  it('填空计划：开启整句时追加复述轮，且同一组空不重复', () => {
    const rounds = buildGoldenFillPlan('We should keep up with the news.', [
      { en: 'keep up with', zh: '跟上', kind: 'idiom' },
    ])
    expect(rounds.some((r) => r.scope === 'sentence')).toBe(true)
    expect(new Set(rounds.map((r) => goldenClozeKey(r.cloze))).size).toBe(rounds.length)
  })

  it('长句最后一轮只挖目标所在的分句，避免一次填整段', () => {
    const text =
      'The committee reviewed the draft, and the board considered the budget after the staff published the detailed report about the new plan for next year and the following season.'
    const rounds = buildGoldenSentenceFillRounds(text, [
      { en: 'considered the budget', zh: '审议预算', kind: 'collocation' },
    ])
    const last = rounds.at(-1)?.cloze
    expect(last).toBeTruthy()
    expect(last!.blanks.length).toBeGreaterThan(1)
    expect(last!.blanks.length).toBeLessThan(text.split(/\s+/).length)
    expect(last!.blanks.map((b) => b.answer).join(' ')).toContain('considered the budget')
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
