import { describe, it, expect } from 'vitest'
import {
  applyConfusables,
  applyLemmaMap,
  applyPosAnalysis,
  applyWordAnalysis,
  markWord,
  relemmaLibrary,
} from './analysis'
import { createLibrary, editItem } from './library'
import { dedupeLibrary } from './merge'
import { vocabItem } from '../testFixtures'

const NOW = new Date('2026-10-02T00:00:00.000Z')
const item = vocabItem

describe('markWord', () => {
  it('新建词条，回填来源与例句', () => {
    const { library, item: created, created: isNew } = markWord(
      createLibrary(),
      { word: 'Running', articleId: 'a1', fileName: 'f.mp3', sentenceId: 's001', sentenceText: 'He is running fast.' },
      NOW,
    )
    expect(isNew).toBe(true)
    expect(created.lemma).toBe('run')
    expect(created.status).toBe('unqueried')
    expect(created.examples).toHaveLength(1)
    expect(created.source).toMatchObject({ articleId: 'a1', fileName: 'f.mp3', sentenceId: 's001' })
    expect(library.items).toHaveLength(1)
  })

  it('按 lemma 去重：大小写 / 变形不新建', () => {
    let lib = createLibrary()
    const first = markWord(lib, { word: 'running', articleId: 'a1', sentenceId: 's1', sentenceText: 'He is running.' }, NOW)
    lib = first.library
    const second = markWord(lib, { word: 'Runs', articleId: 'a2', sentenceId: 's2', sentenceText: 'She runs daily.' }, NOW)
    expect(second.created).toBe(false)
    expect(second.library.items).toHaveLength(1)
    expect(second.item.examples).toHaveLength(2)
    expect(second.item.source?.articleId).toBe('a1')
  })

  it('同一句重复标记不追加重复例句', () => {
    let lib = createLibrary()
    lib = markWord(lib, { word: 'run', articleId: 'a1', sentenceId: 's1', sentenceText: 'Run!' }, NOW).library
    lib = markWord(lib, { word: 'run', articleId: 'a1', sentenceId: 's1', sentenceText: 'Run!' }, NOW).library
    expect(lib.items[0].examples).toHaveLength(1)
  })

  it('空词抛错', () => {
    expect(() => markWord(createLibrary(), { word: '  ', articleId: 'a1' }, NOW)).toThrow()
  })
})

describe('applyWordAnalysis', () => {
  it('把查词结果填进已有词条', () => {
    let lib = markWord(createLibrary(), { word: 'run', articleId: 'a1', sentenceId: 's1', sentenceText: 'Run!' }, NOW).library
    lib = applyWordAnalysis(lib, [
      { word: 'running', phonetic: '/r\u028c\u014b\u026a\u014b/', partOfSpeech: 'v.', meaning: '\u8dd1', usage: ['run a business'], examples: [{ text: 'I run.', translation: '\u6211\u8dd1\u3002' }] },
    ], NOW)
    const it0 = lib.items[0]
    expect(it0.phonetic).toBe('/r\u028c\u014b\u026a\u014b/')
    expect(it0.meaning).toBe('\u8dd1')
    expect(it0.usage).toEqual(['run a business'])
    expect(it0.status).toBe('queried')
    expect(it0.examples).toHaveLength(2)
  })

  it('查词结果把 word/lemma/id 一起改成原形', () => {
    let lib = markWord(createLibrary(), { word: 'companies', articleId: 'a1' }, NOW).library
    expect(lib.items[0].lemma).toBe('company')
    lib = applyWordAnalysis(lib, [{ word: 'company', meaning: '公司' }], NOW)
    expect(lib.items[0].word).toBe('company')
    expect(lib.items[0].lemma).toBe('company')
    expect(lib.items[0].id).toBe('vocab:company')
  })

  it('手动改过的含义不被覆盖', () => {
    let lib = markWord(createLibrary(), { word: 'run', articleId: 'a1' }, NOW).library
    lib = editItem(lib, lib.items[0].id, { meaning: '\u6211\u81ea\u5df1\u7684\u91ca\u4e49' }, NOW)
    lib = applyWordAnalysis(lib, [{ word: 'run', meaning: '\u8dd1' }], NOW)
    expect(lib.items[0].meaning).toBe('\u6211\u81ea\u5df1\u7684\u91ca\u4e49')
    expect(lib.items[0].status).toBe('edited')
  })

  it('只锁手动改过的字段，其他字段仍可由 AI 补', () => {
    let lib = markWord(createLibrary(), { word: 'run', articleId: 'a1' }, NOW).library
    lib = editItem(lib, lib.items[0].id, { meaning: '我的释义' }, NOW)
    lib = applyWordAnalysis(
      lib,
      [{ word: 'run', phonetic: '/rʌn/', meaning: '跑', definition: 'to move fast' }],
      NOW,
    )
    const it = lib.items[0]
    expect(it.meaning).toBe('我的释义')
    expect(it.phonetic).toBe('/rʌn/')
    expect(it.definition).toBe('to move fast')
    expect(it.fieldSources).toMatchObject({ meaning: 'manual', phonetic: 'ai', definition: 'ai' })
  })

  it('新词条逐字段记来源（AI 没给的由词典补）', () => {
    const lib = applyWordAnalysis(
      createLibrary(),
      [
        {
          word: 'run',
          phonetic: '/rʌn/',
          partOfSpeech: 'v.',
          meaning: '跑',
          definition: 'to move fast',
          fieldSources: { meaning: 'dict' },
        },
      ],
      NOW,
    )
    expect(lib.items[0].fieldSources).toEqual({
      phonetic: 'ai',
      partOfSpeech: 'ai',
      meaning: 'dict',
      definition: 'ai',
    })
  })

  it('没标记过的词也会建条目', () => {
    const lib = applyWordAnalysis(createLibrary(), [{ word: 'phonics', meaning: '\u81ea\u7136\u62fc\u8bfb\u6cd5' }], NOW)
    expect(lib.items).toHaveLength(1)
    expect(lib.items[0].status).toBe('queried')
    expect(lib.items[0].source).toBeNull()
  })

  it('用法去重合并', () => {
    let lib = markWord(createLibrary(), { word: 'run', articleId: 'a1' }, NOW).library
    lib = applyWordAnalysis(lib, [{ word: 'run', usage: ['run a business', 'run out'] }], NOW)
    lib = applyWordAnalysis(lib, [{ word: 'running', usage: ['run out', 'run late'] }], NOW)
    expect(lib.items[0].usage).toEqual(['run a business', 'run out', 'run late'])
  })

  it('释义被换掉时词性跟着换（不能一个来自词典首义、一个来自 AI 语境义）', () => {
    // consort 真实病例：先被词典补成「n. 配偶」，AI 查词给动词义「交往；厮混」→ 卡上成了「n. 交往；厮混」
    let lib = markWord(createLibrary(), { word: 'consort', articleId: 'a1' }, NOW).library
    lib = applyWordAnalysis(lib, [{ word: 'consort', partOfSpeech: 'n.', meaning: '配偶', fieldSources: { partOfSpeech: 'dict', meaning: 'dict' } }], NOW)
    expect(lib.items[0].partOfSpeech).toBe('n.')
    lib = applyWordAnalysis(lib, [{ word: 'consort', partOfSpeech: 'v.', meaning: '交往；厮混' }], NOW)
    expect(lib.items[0].meaning).toBe('交往；厮混')
    expect(lib.items[0].partOfSpeech).toBe('v.')
  })

  it('释义变了但 AI 没给词性 → 旧的词典词性清掉，别硬凑', () => {
    let lib = markWord(createLibrary(), { word: 'dwarf', articleId: 'a1' }, NOW).library
    lib = applyWordAnalysis(lib, [{ word: 'dwarf', partOfSpeech: 'n.', meaning: '矮子', fieldSources: { partOfSpeech: 'dict', meaning: 'dict' } }], NOW)
    lib = applyWordAnalysis(lib, [{ word: 'dwarf', meaning: '使相形见绌' }], NOW)
    expect(lib.items[0].meaning).toBe('使相形见绌')
    expect(lib.items[0].partOfSpeech).toBeNull()
  })

  it('释义没变就只补空（不无谓改词性）', () => {
    let lib = markWord(createLibrary(), { word: 'run', articleId: 'a1' }, NOW).library
    lib = applyWordAnalysis(lib, [{ word: 'run', partOfSpeech: 'v.', meaning: '跑', fieldSources: { partOfSpeech: 'dict', meaning: 'dict' } }], NOW)
    lib = applyWordAnalysis(lib, [{ word: 'run', meaning: '跑' }], NOW)
    expect(lib.items[0].partOfSpeech).toBe('v.')
  })
})
describe('markWord 词组 / 带释义 / -ed 还原', () => {
  it('markWord 可带释义（词组 — 中文 拆出来的），并直接标 queried', () => {
    const r = markWord(createLibrary(), { word: 'fall back on', articleId: 'a1', meaning: '转而依靠' }, NOW)
    expect(r.created).toBe(true)
    expect(r.item.meaning).toBe('转而依靠')
    expect(r.item.fieldSources).toEqual({ meaning: 'manual' })
    expect(r.item.status).toBe('queried')
    expect(r.item.lemma).toBe('fall back on') // 短语不做词形还原
  })
  it('ensconced：启发式 lemma 不完美（ensconc），但原词形保留 + 词典可纠正', () => {
    const r = markWord(createLibrary(), { word: 'ensconced', articleId: 'a1', sentenceText: 'He is ensconced in the job.' }, NOW)
    expect(r.created).toBe(true)
    expect(r.item.word).toBe('ensconced') // 原词形原样留着
    expect(r.item.lemma).toBe('ensconc') // 启发式还原（离线词典就绪后会被自动纠正为 ensconce）
  })
})
describe('applyWordAnalysis 默认来源', () => {
  it('新词条带上默认来源（用于归属到当前文章）', () => {
    const src = { articleId: 'a1', fileName: 'art-A', sentenceId: 's1', sentenceText: 'Foo bar.' }
    const lib = applyWordAnalysis(createLibrary(), [{ word: 'foo', meaning: 'x' }], NOW, src)
    expect(lib.items[0].source).toEqual(src)
  })
})
describe('applyConfusables', () => {
  it('按 lemma 写回混淆项', () => {
    let lib = markWord(createLibrary(), { word: 'adapt', articleId: 'a1' }, NOW).library
    lib = applyConfusables(lib, [{ word: 'adapts', confusables: [{ word: 'adopt', meaning: '采用' }] }], 'ai', NOW)
    expect(lib.items[0].confusables).toEqual([{ word: 'adopt', meaning: '采用' }])
    expect(lib.items[0].confusablesSource).toBe('ai')
  })
  it('写入时按调用方标来源（离线词典）', () => {
    let lib = markWord(createLibrary(), { word: 'adapt', articleId: 'a1' }, NOW).library
    lib = applyConfusables(lib, [{ word: 'adapt', confusables: [{ word: 'adopt' }] }], 'dict', NOW)
    expect(lib.items[0].confusablesSource).toBe('dict')
  })
  it('匹配不到的词条不动', () => {
    const lib = applyConfusables(createLibrary(), [{ word: 'zzz', confusables: [{ word: 'x' }] }], 'ai', NOW)
    expect(lib.items).toHaveLength(0)
  })
  it('去重合并（dedupeLibrary）', () => {
    const a = item({ id: 'vocab:a', lemma: 'adapt', word: 'adapt', confusables: [{ word: 'adopt' }] })
    const b = item({ id: 'vocab:b', lemma: 'adapt', word: 'adapt', confusables: [{ word: 'adopt' }, { word: 'adept' }] })
    const lib = dedupeLibrary({ schemaVersion: 1, items: [a, b] })
    expect(lib.items[0].confusables).toEqual([{ word: 'adopt' }, { word: 'adept' }])
  })
})
describe('原形校正 / 去重', () => {
  it('applyLemmaMap 把非原型改为原形（word/lemma/id）', () => {
    let lib = markWord(createLibrary(), { word: 'saw', articleId: 'a1' }, NOW).library
    lib = applyLemmaMap(lib, [{ from: 'saw', to: 'see' }], NOW)
    expect(lib.items[0].word).toBe('see')
    expect(lib.items[0].lemma).toBe('see')
    expect(lib.items[0].id).toBe('vocab:see')
  })
  it('applyLemmaMap 后 dedupe 合并同一原形的词', () => {
    let lib = markWord(createLibrary(), { word: 'seen', articleId: 'a1' }, NOW).library
    lib = markWord(lib, { word: 'saw', articleId: 'a1' }, NOW).library
    expect(lib.items).toHaveLength(2) // seen / saw 是两个 lemma
    lib = applyLemmaMap(lib, [{ from: 'seen', to: 'see' }, { from: 'saw', to: 'see' }], NOW)
    lib = dedupeLibrary(lib)
    expect(lib.items).toHaveLength(1)
    expect(lib.items[0].lemma).toBe('see')
  })
  it('relemmaLibrary 按 word 重算 lemma', () => {
    const it = item({ id: 'vocab:x', word: 'running', lemma: 'running' })
    const lib = relemmaLibrary({ schemaVersion: 1, items: [it] })
    expect(lib.items[0].lemma).toBe('run')
  })
})
describe('applyPosAnalysis', () => {
  const row = {
    lemma: 'slide',
    surface: 'sliding',
    pos: 'adj.',
    syntax: '现在分词转化来的形容词，作定语',
    role: '修饰 prices',
    meaning: '持续下跌的',
    reason: '相当于 prices that are sliding',
    label: 'adj.（分词形容词）',
  }
  it('单词条目按原形改写并写入词性 / 笔记', () => {
    let lib = markWord(createLibrary(), { word: 'sliding', articleId: 'a1' }, NOW).library
    lib = applyPosAnalysis(lib, [row], NOW)
    expect(lib.items[0].word).toBe('slide')
    expect(lib.items[0].lemma).toBe('slide')
    expect(lib.items[0].partOfSpeech).toBe('adj.')
    expect(lib.items[0].note).toContain('辨析')
  })
  it('手动改过的词性不被 AI 辨析覆盖', () => {
    let lib = markWord(createLibrary(), { word: 'sliding', articleId: 'a1' }, NOW).library
    lib = editItem(lib, lib.items[0].id, { partOfSpeech: 'n.' }, NOW)
    lib = applyPosAnalysis(lib, [row], NOW)
    const it = lib.items[0]
    expect(it.partOfSpeech).toBe('n.')
    expect(it.fieldSources).toMatchObject({ partOfSpeech: 'manual' })
    expect(it.note).toContain('辨析')
  })

  it('短语条目不改词形，只记笔记', () => {
    let lib = markWord(createLibrary(), { word: 'sliding oil price', articleId: 'a1' }, NOW).library
    lib = applyPosAnalysis(lib, [row], NOW)
    expect(lib.items[0].word).toBe('sliding oil price')
    expect(lib.items[0].note).toContain('辨析')
  })

  it('派生词当原形时**不改词形**（unchallenged 不能被改成 challenge）', () => {
    // 真实病例：辨析说 unchallenged 的原形是 challenge，改完 challenge 卡上挂着
    // unchallenged 的词典释义（a. 未引起争论的）→ 词性释义全错位
    let lib = markWord(createLibrary(), { word: 'unchallenged', articleId: 'a1' }, NOW).library
    lib = applyPosAnalysis(
      lib,
      [{ ...row, lemma: 'challenge', surface: 'unchallenged', pos: 'adj.', meaning: '未受质疑的' }],
      NOW,
    )
    const it = lib.items[0]
    expect(it.word).toBe('unchallenged')
    expect(it.lemma).toBe('unchalleng') // 启发性 lemma，但**没有**被改成 challenge
    expect(it.partOfSpeech).toBe('adj.')
    expect(it.note).toContain('未改词形')
  })

  it('真屈折照旧改词形（running → run）', () => {
    let lib = markWord(createLibrary(), { word: 'running', articleId: 'a1' }, NOW).library
    lib = applyPosAnalysis(
      lib,
      [{ ...row, lemma: 'run', surface: 'running', pos: 'v.', meaning: '跑' }],
      NOW,
    )
    expect(lib.items[0].word).toBe('run')
  })
})
