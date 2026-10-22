import { describe, it, expect } from 'vitest'
import {
  cleanVocabWord,
  parseConfusables,
  parseExampleTable,
  parseGrammarMarkTable,
  parseLookupTable,
  parsePhraseTable,
  parsePosTable,
} from './analyzerParse'

describe('analyzerParse 脏输入容忍', () => {
  it('查词表跳过表头、分隔线与空行，Markdown 首尾竖线不产生空列', () => {
    const raw = [
      '| 单词 | 音标 | 词性 | 中文含义 |',
      '| --- | --- | --- | --- |',
      '',
      '| run | /rʌn/ | v. | 跑 |',
    ].join('\n')
    const words = parseLookupTable(raw)
    expect(words).toHaveLength(1)
    expect(words[0].word).toBe('run')
    expect(words[0].phonetic).toBe('/rʌn/')
  })

  it('例句表在一行内丢掉跑飞的长句与重复句', () => {
    const long = 'word '.repeat(40)
    const raw = ['run | He runs fast. | 他跑得快。 | He runs fast. | 重复句 | ' + long + ' | 长句'].join('\n')
    const rows = parseExampleTable(raw)
    expect(rows).toHaveLength(1)
    expect(rows[0].examples).toHaveLength(1)
    expect(rows[0].examples[0].text).toBe('He runs fast.')
  })

  it('词组表把「无」当成已标注（空数组），不是解析失败', () => {
    const rows = parsePhraseTable('mrs | 无 | 无')
    expect(rows).toEqual([{ word: 'mrs', phrases: [], idioms: [] }])
  })

  it('语法标记只保留受控词表里的写法，别名归一，乱写的丢掉', () => {
    const rows = parseGrammarMarkTable('run | 可数；transitive；胡写\nbad | 胡写')
    expect(rows[0]).toEqual({ word: 'run', marks: ['可数', '及物'] })
    expect(rows[1]).toEqual({ word: 'bad', marks: [] })
  })

  it('非表格自由文本解析成空，不抛异常', () => {
    expect(parseLookupTable('just some prose')).toEqual([])
    expect(parseExampleTable('a | b')).toEqual([])
    expect(parseConfusables('no pipe here')).toEqual([])
    expect(parsePosTable('a | b | c')).toEqual([])
  })

  it('原形表去掉括号注释与逗号后的补充说明', () => {
    expect(parseConfusables('adapt | adopt:收养 ; adept：熟练的')).toEqual([
      { word: 'adapt', confusables: [{ word: 'adopt', meaning: '收养' }, { word: 'adept', meaning: '熟练的' }] },
    ])
  })

  it('cleanVocabWord 从「1. **词 (n.)** — 释义」里只取词形', () => {
    expect(cleanVocabWord('1. **impeachment (n.)** — 弹劾')).toBe('impeachment')
    expect(cleanVocabWord('non-native')).toBe('non-native')
  })
})
