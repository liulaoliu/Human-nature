import { describe, it, expect } from 'vitest'
import { canRewriteTo, cleanGloss, displayMeaning, lemmaOf, normalizePos, normalizeWord } from './word'

describe('释义/词性清洗', () => {
  it('cleanGloss 去掉行尾反斜杠与多余空白', () => {
    expect(cleanGloss('n. 林学, 森林地\\')).toBe('n. 林学, 森林地')
    expect(cleanGloss('  a word formed by something \\ ')).toBe('a word formed by something')
  })
  it('normalizePos 全称 → 缩写', () => {
    expect(normalizePos('noun')).toBe('n.')
    expect(normalizePos('verb')).toBe('v.')
    expect(normalizePos('n.')).toBe('n.')
    expect(normalizePos('')).toBe('')
  })
  it('displayMeaning 去掉与词性重复的开头', () => {
    expect(displayMeaning({ partOfSpeech: 'noun', meaning: 'n. 林学, 森林地\\' })).toBe('林学, 森林地')
    expect(displayMeaning({ partOfSpeech: 'n.', meaning: '小群, 子群\\' })).toBe('小群, 子群')
    // 没有词性时，保留释义自带的词性前缀
    expect(displayMeaning({ partOfSpeech: '', meaning: 'n. 小群\\' })).toBe('n. 小群')
  })
})
describe('normalizeWord', () => {
  it('统一撇号、去标点、转小写', () => {
    expect(normalizeWord('Mississippi\u2019s,')).toBe("mississippi's")
    expect(normalizeWord('Phonics')).toBe('phonics')
  })
  it('连字符保留', () => {
    expect(normalizeWord('state-of-the-art')).toBe('state-of-the-art')
  })
})

describe('lemmaOf', () => {
  it('复数 → 原形', () => {
    expect(lemmaOf('cats')).toBe('cat')
    expect(lemmaOf('studies')).toBe('study')
    expect(lemmaOf('boxes')).toBe('box')
  })
  it('-ing / -ed → 原形', () => {
    expect(lemmaOf('running')).toBe('run')
    expect(lemmaOf('watched')).toBe('watch')
  })
  it('不规则形查表', () => {
    expect(lemmaOf('ran')).toBe('run')
    expect(lemmaOf('children')).toBe('child')
    expect(lemmaOf('went')).toBe('go')
  })
  it('所有格', () => {
    expect(lemmaOf("Mississippi's")).toBe('mississippi')
  })
  it('以 us/ss/is/os 结尾的词不误删 s（census/status/analysis）', () => {
    expect(lemmaOf('census')).toBe('census')
    expect(lemmaOf('status')).toBe('status')
    expect(lemmaOf('analysis')).toBe('analysis')
    expect(lemmaOf('boss')).toBe('boss')
  })
  it('空词返回空串', () => {
    expect(lemmaOf('   ')).toBe('')
  })
})
describe('lemmaOf 短语', () => {
  it('含空格的短语不做词形还原，保持原样（小写）', () => {
    expect(lemmaOf('human rights')).toBe('human rights')
    expect(lemmaOf('Climate Change')).toBe('climate change')
  })
})

describe('canRewriteTo：只有屈折能改名，派生词不行', () => {
  it('屈折变化放行', () => {
    expect(canRewriteTo('runs', 'run')).toBe(true)
    expect(canRewriteTo('running', 'run')).toBe(true) // 双写尾辅音
    expect(canRewriteTo('watched', 'watch')).toBe(true)
    expect(canRewriteTo('swelling', 'swell')).toBe(true)
    expect(canRewriteTo('expunging', 'expunge')).toBe(true) // 去 e 加 -ing
    expect(canRewriteTo('companies', 'company')).toBe(true) // y → ies
    expect(canRewriteTo('analyses', 'analysis')).toBe(true) // -ses → -sis
    expect(canRewriteTo('went', 'go')).toBe(true) // 不规则表
    expect(canRewriteTo('children', 'child')).toBe(true)
    expect(canRewriteTo('same', 'same')).toBe(true)
  })

  it('否定/反义前缀派生出来的词不是词形变化（2026-10-22 的 bug）', () => {
    expect(canRewriteTo('unchallenged', 'challenge')).toBe(false)
    expect(canRewriteTo('unarticulated', 'articulate')).toBe(false)
    expect(canRewriteTo('inarticulate', 'articulate')).toBe(false)
    expect(canRewriteTo('discouraged', 'courage')).toBe(false)
    expect(canRewriteTo('nonviolent', 'violent')).toBe(false)
  })

  it('其它派生后缀也不改名（teacher ≠ teach 的变形）', () => {
    expect(canRewriteTo('teacher', 'teach')).toBe(false)
    expect(canRewriteTo('quickly', 'quick')).toBe(false)
    expect(canRewriteTo('kindness', 'kind')).toBe(false)
    expect(canRewriteTo('creation', 'create')).toBe(false)
    expect(canRewriteTo('beautiful', 'beauty')).toBe(false)
  })

  it('短语与空串不放行', () => {
    expect(canRewriteTo('fall back on', 'fall back')).toBe(false)
    expect(canRewriteTo('', 'run')).toBe(false)
    expect(canRewriteTo('run', '')).toBe(false)
  })
})
