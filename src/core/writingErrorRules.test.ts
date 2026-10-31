import { describe, it, expect } from 'vitest'
import {
  WRITING_RULE_TYPE,
  WRITING_RULES,
  classifyLegacyIssue,
  isWritingIssueKey,
  isWritingRule,
  writingKeyFor,
  writingKeySlug,
  writingRuleCatalog,
  writingTypeOf,
} from './writingErrorRules'

describe('writingErrorRules：闭集与标签', () => {
  it('每条 rule 都有 type；catalog 覆盖全部 rule', () => {
    for (const rule of WRITING_RULES) {
      expect(WRITING_RULE_TYPE[rule]).toBeTruthy()
    }
    const catalog = writingRuleCatalog()
    for (const rule of WRITING_RULES) expect(catalog).toContain(rule)
  })

  it('rule / key 的形状校验', () => {
    expect(isWritingRule('chunk-sense')).toBe(true)
    expect(isWritingRule('Chunk Sense')).toBe(false)
    expect(isWritingIssueKey('chunk-an-end-to')).toBe(true)
    expect(isWritingIssueKey('Chunk')).toBe(false)
    expect(writingKeySlug('an end to')).toBe('an-end-to')
    expect(writingKeySlug('  ')).toBe('x')
  })

  it('机械规则用规则级 key，词汇错因用具体片段', () => {
    expect(writingKeyFor('sentence-initial-capital', 'this new policy', 'This new policy')).toBe(
      'sentence-initial-capital',
    )
    expect(writingKeyFor('word-spelling', 'bureacracy', 'bureaucracy')).toBe('spelling-bureaucracy')
    expect(writingKeyFor('chunk-sense', 'come to an end', 'bring an end to')).toBe('chunk-bring-an-end-to')
  })

  it('type 只从 rule 推导（AI 写错 type 也不会把趋势带歪）', () => {
    expect(writingTypeOf('comma-followed-by-space')).toBe('punctuation')
    expect(writingTypeOf('chunk-sense')).toBe('chunk')
  })
})

describe('classifyLegacyIssue：把旧批改映射到新标签', () => {
  const cases: Array<[string, string, string, string]> = [
    ['this new policy', 'This new policy', '句首单词首字母必须大写。', 'sentence-initial-capital'],
    ['devotees,but', 'devotees, but', '逗号后缺少空格，标点格式不规范。', 'comma-followed-by-space'],
    ['bureacracy', 'bureaucracy', '拼写错误，正确拼写为 bureaucracy。', 'word-spelling'],
    ['compared to pretentious performance', 'compared to religious worship', '未使用题目要求必须使用的词块 religious worship；', 'chunk-missing'],
    ['advocates to slow', 'advocates slowing', '搭配错误：advocate 作动词不能接不定式 to do。', 'verb-pattern'],
    ['Much as what has been told.', 'Much as we were told last year, ...', 'much as 是连词，须引导完整的从句；且原句缺少主句，不成句。', 'incomplete-clause'],
    ['my personal things', 'my private matters', '搭配问题：personal things 偏中式、过于笼统。', 'literal-translation'],
    ['his handsome elf friend', 'his tall, handsome elf friend', '补一个形容词后指代更清晰，句子更顺。', 'unclear-reference'],
  ]

  for (const [original, suggestion, reason, rule] of cases) {
    it(`${rule}`, () => {
      const got = classifyLegacyIssue({ original, suggestion, reason })
      expect(got.rule).toBe(rule)
      expect(got.type).toBe(WRITING_RULE_TYPE[rule as keyof typeof WRITING_RULE_TYPE])
      expect(got.key.length).toBeGreaterThan(2)
    })
  }

  it('纯风格建议算 improvement，硬错算 must-fix', () => {
    const style = classifyLegacyIssue({
      original: 'this drilling process',
      suggestion: 'the era of routine drilling exercises',
      reason: '搭配范围过窄，语义不自然；可改为抽象名词短语。',
    })
    expect(style.severity).toBe('improvement')
    const hard = classifyLegacyIssue({
      original: 'an en',
      suggestion: 'an end',
      reason: '拼写错误：词块是 an end to，en 不是英语单词。',
    })
    expect(hard.severity).toBe('must-fix')
  })
})
