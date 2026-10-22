import { describe, it, expect } from 'vitest'
import { FENCE, HEADER, LOOKUP_FIELDS, cleanExampleText, quoted, splitList } from './analyzerShared'

describe('analyzerShared 公共底座', () => {
  it('quoted：三引号包住并去掉首尾空白', () => {
    expect(quoted('  hello\n ')).toBe('"""\nhello\n"""')
    expect(quoted('')).toBe('"""\n\n"""')
  })

  it('FENCE / HEADER 与提示词约定一致', () => {
    expect(FENCE).toBe('"""')
    expect(HEADER).toContain('只输出结果')
    expect(HEADER).not.toContain('\n')
  })

  it('LOOKUP_FIELDS 顺序就是提示词与解析的列序（改动会同时炸两边）', () => {
    expect(LOOKUP_FIELDS).toEqual(['word', 'phonetic', 'partOfSpeech', 'meaning', 'usage', 'example'])
  })

  it('splitList：换行/分号/顿号都拆，去项目符号与编号，丢空项', () => {
    expect(splitList('run out — 用完；run a business — 经营公司')).toEqual([
      'run out — 用完',
      'run a business — 经营公司',
    ])
    expect(splitList('1. alpha\n- beta、3. gamma\n\n')).toEqual(['alpha', 'beta', 'gamma'])
  })

  it('cleanExampleText：去编号与包裹引号，抹平连续空白', () => {
    expect(cleanExampleText('  1. "Hello   world."')).toBe('Hello world.')
    expect(cleanExampleText('“中文引号”')).toBe('中文引号')
    expect(cleanExampleText('')).toBe('')
  })
})
