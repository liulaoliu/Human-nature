import { describe, it, expect } from 'vitest'
import {
  applyToSentence,
  buildBatchLookupPrompt,
  buildCleanupPrompt,
  buildPrompt,
  parseAnalysis,
  parseLookupTable,
  parseWordList,
} from './analyzer'
import { defaultReviewState } from '../types/document'
import type { Sentence } from '../types/document'

function sentence(text: string): Sentence {
  return {
    id: 's001',
    paraId: 'p01',
    text,
    audio: null,
    translation: null,
    grammarNote: null,
    collocations: [],
    vocab: [],
    tags: [],
    reviewState: defaultReviewState(),
  }
}

describe('buildPrompt', () => {
  it('翻译包含原文与「只输出译文」', () => {
    const p = buildPrompt({ task: 'translate', text: 'He left.' })
    expect(p).toContain('He left.')
    expect(p).toContain('只输出译文')
  })
  it('查词包含单词、字段格式和分隔符说明', () => {
    const p = buildPrompt({ task: 'lookup', text: 'He runs.', words: ['running', 'runs'] })
    expect(p).toContain('running, runs')
    expect(p).toContain('单词 | 音标 | 词性 | 中文含义')
    expect(p).toContain('国际音标')
    expect(p).toContain('原形')
    expect(p).toContain('He runs.')
  })
  it('提取生词要求逗号分隔', () => {
    const p = buildPrompt({ task: 'extract_vocab', text: 'a paragraph' })
    expect(p).toContain('逗号分隔')
    expect(p).toContain('a paragraph')
  })
  it('每种任务都带角色约束', () => {
    for (const task of ['translate', 'grammar', 'collocations', 'summarize', 'extract_vocab', 'lookup'] as const) {
      expect(buildPrompt({ task, text: 'x' })).toContain('你是英语精读助手')
    }
  })
})

describe('parseLookupTable', () => {
  const table = [
    '单词 | 音标 | 词性 | 中文含义 | 用法/搭配 | 例句(英+中)',
    'running | /ˈrʌnɪŋ/ | v. | 跑步 | run a business；run out | I run every day. — 我每天跑步。',
    'mitigate | /ˈmɪtɪɡeɪt/ | v. | 缓解 | mitigate the risk | This helps mitigate the risk. — 这有助于缓解风险。',
  ].join('\n')

  it('解析表格并跳过表头', () => {
    const words = parseLookupTable(table)
    expect(words).toHaveLength(2)
    expect(words[0]).toMatchObject({ word: 'running', phonetic: '/ˈrʌnɪŋ/', partOfSpeech: 'v.', meaning: '跑步' })
  })
  it('用法按「；」拆开', () => {
    expect(parseLookupTable(table)[0].usage).toEqual(['run a business', 'run out'])
  })
  it('例句按「 — 」拆成英中', () => {
    expect(parseLookupTable(table)[0].examples?.[0]).toEqual({
      text: 'I run every day.',
      translation: '我每天跑步。',
    })
  })
  it('空字段留空不编造', () => {
    const words = parseLookupTable('foo | | | | |')
    expect(words[0]).toMatchObject({ word: 'foo' })
    expect(words[0].phonetic).toBeUndefined()
  })
  it('忽略横线分隔行', () => {
    expect(parseLookupTable('--- | --- | ---')).toHaveLength(0)
  })
})

describe('parseAnalysis', () => {
  it('解析 JSON 数组', () => {
    const r = parseAnalysis('[{"word":"run","meaning":"跑"}]')
    expect(r.words?.[0].word).toBe('run')
  })
  it('解析 JSON 对象（words + sentences）', () => {
    const r = parseAnalysis('{"words":[{"word":"run"}],"sentences":[{"sentenceId":"s1","translation":"x"}]}')
    expect(r.words?.[0].word).toBe('run')
    expect(r.sentences?.[0].translation).toBe('x')
  })
  it('解析表格', () => {
    const r = parseAnalysis('run | | v. | 跑')
    expect(r.words?.[0].meaning).toBe('跑')
  })
  it('空输入返回空对象', () => {
    expect(parseAnalysis('   ')).toEqual({})
  })
})

describe('parseWordList', () => {
  it('逗号/顿号/换行都能拆并去重', () => {
    expect(parseWordList('run, mitigate、run\nphonics')).toEqual(['run', 'mitigate', 'phonics'])
  })
})

describe('applyToSentence', () => {
  const s = sentence('He left.')
  it('翻译写进 translation', () => {
    expect(applyToSentence(s, 'translate', '他离开了。').translation).toBe('他离开了。')
  })
  it('语法写进 grammarNote', () => {
    expect(applyToSentence(s, 'grammar', '主干...').grammarNote).toBe('主干...')
  })
  it('搭配去重合并', () => {
    const a = applyToSentence(s, 'collocations', 'give up；give in')
    const b = applyToSentence(a, 'collocations', 'give up')
    expect(b.collocations).toEqual(['give up', 'give in'])
  })
  it('生词去重合并', () => {
    const a = applyToSentence(s, 'extract_vocab', 'run, mitigate')
    const b = applyToSentence(a, 'extract_vocab', 'run, phonics')
    expect(b.vocab).toEqual(['run', 'mitigate', 'phonics'])
  })
  it('空结果不改动', () => {
    expect(applyToSentence(s, 'translate', '  ')).toEqual(s)
  })
})

describe('buildBatchLookupPrompt', () => {
  it('列出每个词与上下文，并带上字段格式', () => {
    const p = buildBatchLookupPrompt([
      { word: 'abandon', context: 'They abandon the plan.' },
      { word: 'mitigate' },
    ])
    expect(p).toContain('abandon')
    expect(p).toContain('They abandon the plan.')
    expect(p).toContain('mitigate')
    expect(p).toContain('单词 | 音标 | 词性 | 中文含义')
    expect(p).toContain('国际音标')
  })
})

describe('buildCleanupPrompt', () => {
  it('包含指令、原文和「只输出修复后的文本」', () => {
    const p = buildCleanupPrompt('Hong Kong held elections for\nits council.')
    expect(p).toContain('去掉不必要的换行')
    expect(p).toContain('粘连')
    expect(p).toContain('只输出修复后的文本')
    expect(p).toContain('Hong Kong held elections for')
  })
})

describe('buildBatchLookupPrompt 去重', () => {
  it('同一个词（忽略大小写）只列一次', () => {
    const p = buildBatchLookupPrompt([{ word: 'run' }, { word: 'Run' }])
    expect(p.match(/- run/gi)?.length).toBe(1)
  })
})

describe('parseLookupTable 兼容 Markdown 表格', () => {
  it('带前后竖线 | 的表格也要能解析（AI 常这么输出）', () => {
    const md = [
      '| 单词 | 音标 | 词性 | 中文含义 | 用法/搭配 | 例句 |',
      '| --- | --- | --- | --- | --- | --- |',
      '| running | /ˈrʌnɪŋ/ | v. | 跑步 | run out | I run. — 我跑。 |',
    ].join('\n')
    const words = parseLookupTable(md)
    expect(words).toHaveLength(1)
    expect(words[0]).toMatchObject({ word: 'running', phonetic: '/ˈrʌnɪŋ/', partOfSpeech: 'v.', meaning: '跑步' })
  })
  it('音标塞在单词同一格也能拆出来（音标格为空时）', () => {
    const words = parseLookupTable('run /rʌn/ | | v. | 跑')
    expect(words[0]).toMatchObject({ word: 'run', phonetic: '/rʌn/', meaning: '跑' })
  })
})
