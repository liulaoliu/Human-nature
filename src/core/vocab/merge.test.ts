import { describe, it, expect } from 'vitest'
import {
  MAX_EXAMPLES,
  applyExamples,
  applyGrammarMarks,
  applyPhrases,
  betterSource,
  dedupeLibrary,
  hasOwnExamples,
  isMarkablePos,
  marksForPos,
  needsAiExamples,
  normalizeGrammarMarks,
  ownExamples,
  pickOfflineExamples,
  upsertContext,
  vocabCardBlocks,
} from './merge'
import { createLibrary } from './library'
import { applyWordAnalysis, markWord } from './analysis'
import { vocabItem } from '../testFixtures'

const NOW = new Date('2026-10-02T00:00:00.000Z')
const item = vocabItem

describe('applyExamples', () => {
  it('按 lemma / 词形并入例句，并去重', () => {
    let lib = markWord(createLibrary(), { word: 'run', articleId: 'a1' }, NOW).library
    lib = applyExamples(lib, [
      {
        word: 'running',
        examples: [
          { text: 'I run every day.', translation: '我每天跑步。' },
          { text: 'I run every day.', translation: '重复' },
        ],
      },
    ])
    const item = lib.items[0]
    expect(item.examples.filter((e) => e.text === 'I run every day.')).toHaveLength(1)
  })
  it('例句最多保留 6 条（避免反复查词越堆越多）', () => {
    let lib = markWord(createLibrary(), { word: 'run', articleId: 'a1' }, NOW).library
    for (let i = 0; i < 10; i++) {
      lib = applyExamples(lib, [{ word: 'run', examples: [{ text: `He runs ${i}.` }] }])
    }
    const item = lib.items[0]
    expect(item.examples.length).toBeLessThanOrEqual(6)
    // 最早的那条（来源句）保留
    expect(item.examples.map((e) => e.text)).toContain('run')
  })

  it('标记例句来源：article / ai / tatoeba', () => {
    let lib = markWord(createLibrary(), { word: 'run', articleId: 'a1', sentenceText: 'He runs fast.' }, NOW).library
    expect(lib.items[0].examples[0].origin).toBe('article')
    lib = applyExamples(lib, [{ word: 'run', examples: [{ text: 'Friendly words mitigate fury.' }] }], NOW, 'tatoeba')
    expect(lib.items[0].examples.find((e) => e.text.startsWith('Friendly'))?.origin).toBe('tatoeba')
    lib = applyExamples(lib, [{ word: 'run', examples: [{ text: 'I run daily.', translation: '我每天跑。' }] }], NOW)
    expect(lib.items[0].examples.find((e) => e.text === 'I run daily.')?.origin).toBe('ai')
  })

  it('pickOfflineExamples：AI 例句存在时也补离线（目标 3 条、幂等）', () => {
    // 只有来源句 + 1 条 AI 例句
    const it = item({
      examples: [
        { text: 'Src sentence.', origin: 'article' },
        { text: 'AI example.', origin: 'ai' },
      ],
    })
    const cands = [
      { text: 'Off one.', translation: '一' },
      { text: 'Off two.' },
      { text: 'Off three.' },
      { text: 'Off four.' },
    ]
    // 空位 4（上限 6），目标补 3 条 → 取前 3
    expect(pickOfflineExamples(it, cands).map((e) => e.text)).toEqual(['Off one.', 'Off two.', 'Off three.'])
    // 已经有 3 条离线 → 幂等，不再补
    const done = item({
      examples: [
        { text: 'Src.', origin: 'article' },
        { text: 'AI.', origin: 'ai' },
        { text: 'O1.', origin: 'tatoeba' },
        { text: 'O2.', origin: 'tatoeba' },
        { text: 'O3.', origin: 'tatoeba' },
      ],
    })
    expect(pickOfflineExamples(done, cands)).toEqual([])
  })

  it('pickOfflineExamples：跳过已有的相同句子、受卡片上限约束', () => {
    const it = item({
      examples: [
        { text: 'Src.', origin: 'article' },
        { text: 'Already there.', origin: 'ai' },
      ],
    })
    const cands = [{ text: 'Already there.' }, { text: 'New one.' }]
    expect(pickOfflineExamples(it, cands).map((e) => e.text)).toEqual(['New one.'])
    // 已满 6 条 → 一条也不补
    const full = item({
      examples: Array.from({ length: MAX_EXAMPLES }, (_, i) => ({ text: `e${i}`, origin: 'ai' as const })),
    })
    expect(pickOfflineExamples(full, cands)).toEqual([])
  })

  it('离线例句先到，AI 仍会认领（防死循环）', () => {    let lib = markWord(createLibrary(), { word: 'mitigate', articleId: 'a1', sentenceText: 'x' }, NOW).library
    lib = applyExamples(lib, [{ word: 'mitigate', examples: [{ text: 'Algeria needs to mitigate its vulnerabilities.' }] }], NOW, 'tatoeba')
    expect(needsAiExamples(lib.items[0])).toBe(true) // 只有离线 → 还缺 AI 例句
    // AI 回了同一句（被去重）→ 也要认领成 ai，否则会一直排
    lib = applyExamples(lib, [{ word: 'mitigate', examples: [{ text: 'Algeria needs to mitigate its vulnerabilities.', translation: '阿尔及利亚需要降低其脆弱性。' }] }], NOW)
    const ex = lib.items[0].examples.find((e) => e.text.startsWith('Algeria'))
    expect(ex?.origin).toBe('ai')
    expect(ex?.translation).toBe('阿尔及利亚需要降低其脆弱性。')
    expect(needsAiExamples(lib.items[0])).toBe(false)
  })
})

describe('applyPhrases', () => {
  it('按 lemma 并入词组/习语，并去重', () => {
    let lib = markWord(createLibrary(), { word: 'run', articleId: 'a1' }, NOW).library
    lib = applyPhrases(
      lib,
      [{ word: 'running', phrases: ['run out', 'run out'], idioms: ['run in the family'] }],
      NOW,
    )
    expect(lib.items[0].phrases).toEqual(['run out'])
    expect(lib.items[0].idioms).toEqual(['run in the family'])
  })
  it('已在「用法」里的词组不再重复写进「词组」', () => {
    let lib = markWord(createLibrary(), { word: 'run', articleId: 'a1' }, NOW).library
    lib = applyWordAnalysis(lib, [{ word: 'run', usage: ['run out'] }], NOW)
    lib = applyPhrases(lib, [{ word: 'run', phrases: ['run out', 'run late'], idioms: [] }], NOW)
    expect(lib.items[0].phrases).toEqual(['run late'])
  })
  it('匹配不到的词条不动', () => {
    const lib = applyPhrases(createLibrary(), [{ word: 'zzz', phrases: ['zzz out'], idioms: [] }], NOW)
    expect(lib.items).toHaveLength(0)
  })
  it('没有词组也写入空数组（=已标注，避免重复跑批）', () => {
    let lib = markWord(createLibrary(), { word: 'mrs', articleId: 'a1' }, NOW).library
    expect(lib.items[0].phrases).toBeUndefined()
    lib = applyPhrases(lib, [{ word: 'mrs', phrases: [], idioms: [] }], NOW)
    expect(lib.items[0].phrases).toEqual([])
    expect(lib.items[0].idioms).toEqual([])
  })
})

describe('applyGrammarMarks / isMarkablePos', () => {
  it('按 lemma 合并语法标记并去重', () => {
    let lib = markWord(createLibrary(), { word: 'water', articleId: 'a1' }, NOW).library
    lib = applyGrammarMarks(lib, [{ word: 'water', marks: ['不可数', '不可数'] }], NOW)
    expect(lib.items[0].grammarMarks).toEqual(['不可数'])
  })
  it('已标过的词再合并新标记（去重）', () => {
    let lib = markWord(createLibrary(), { word: 'run', articleId: 'a1' }, NOW).library
    lib = applyGrammarMarks(lib, [{ word: 'run', marks: ['及物'] }], NOW)
    lib = applyGrammarMarks(lib, [{ word: 'runs', marks: ['及物', '不及物', '可数'] }], NOW)
    expect(lib.items[0].grammarMarks).toEqual(['及物', '不及物', '可数'])
  })
  it('匹配不到的词条不动', () => {
    const lib = applyGrammarMarks(createLibrary(), [{ word: 'zzz', marks: ['可数'] }], NOW)
    expect(lib.items).toHaveLength(0)
  })
  it('没有可标项也写入空数组（=已标注，避免重复跑批）', () => {
    let lib = markWord(createLibrary(), { word: 'mrs', articleId: 'a1' }, NOW).library
    expect(lib.items[0].grammarMarks).toBeUndefined()
    lib = applyGrammarMarks(lib, [{ word: 'mrs', marks: [] }], NOW)
    expect(lib.items[0].grammarMarks).toEqual([])
  })
  it('isMarkablePos 认名词/动词/形容词，不认介词/代词/数词', () => {
    expect(isMarkablePos('n.')).toBe(true)
    expect(isMarkablePos('noun')).toBe(true)
    expect(isMarkablePos('v.')).toBe(true)
    expect(isMarkablePos('n./v.')).toBe(true)
    expect(isMarkablePos('adj.')).toBe(true)
    expect(isMarkablePos('prep.')).toBe(false)
    expect(isMarkablePos('pron.')).toBe(false)
    expect(isMarkablePos('num.')).toBe(false)
    expect(isMarkablePos('adv.')).toBe(false)
    expect(isMarkablePos(null)).toBe(false)
  })
})

describe('ownExamples / hasOwnExamples', () => {
  it('排除与来源句相同的那条', () => {
    const it = item({
      examples: [{ text: 'He runs.' }, { text: 'I run every day.' }],
      source: { articleId: 'a', fileName: null, sentenceId: 's1', sentenceText: 'He runs.' },
    })
    expect(ownExamples(it).map((e) => e.text)).toEqual(['I run every day.'])
    expect(hasOwnExamples(it)).toBe(true)
  })
  it('只有来源句时等于没有自己的例句', () => {
    const it = item({
      examples: [{ text: 'He runs.' }],
      source: { articleId: 'a', fileName: null, sentenceId: 's1', sentenceText: 'He runs.' },
    })
    expect(hasOwnExamples(it)).toBe(false)
  })
})

describe('vocabCardBlocks', () => {
  it('按固定顺序输出带小标题的块，只含有内容的', () => {
    const it = item({
      usage: ['run a business'],
      phrases: ['run out'],
      idioms: ['run in the family'],
      examples: [
        { text: 'He runs.' },
        { text: 'I run every day.', translation: '我每天跑步。' },
      ],
      source: { articleId: 'a', fileName: null, sentenceId: 's1', sentenceText: 'He runs.' },
      confusables: [{ word: 'ran', meaning: '跑步' }],
    })
    const blocks = vocabCardBlocks(it)
    expect(blocks.map((b) => b.label)).toEqual(['用法', '词组', '习语', '例句', '来源', '易混'])
    expect(blocks.find((b) => b.label === '例句')?.lines).toEqual(['I run every day. — 我每天跑步。'])
    expect(blocks.find((b) => b.label === '易混')?.lines).toEqual(['ran（跑步）'])
  })
  it('易混块按来源加标签；旧数据没有来源就不标', () => {
    const ai = vocabCardBlocks(
      item({ confusables: [{ word: 'adopt', meaning: '采用' }], confusablesSource: 'ai' }),
    )
    expect(ai.find((b) => b.key === 'confusables')?.lines).toEqual(['[AI] adopt（采用）'])

    const dict = vocabCardBlocks(item({ confusables: [{ word: 'adept' }], confusablesSource: 'dict' }))
    expect(dict.find((b) => b.key === 'confusables')?.lines).toEqual(['[词典] adept'])

    const legacy = vocabCardBlocks(item({ confusables: [{ word: 'adopt' }] }))
    expect(legacy.find((b) => b.key === 'confusables')?.lines).toEqual(['adopt'])
  })
  it('maxExamples 截断例句；没有内容的块不出现', () => {
    const it = item({ examples: [{ text: 'a' }, { text: 'b' }, { text: 'c' }] })
    const blocks = vocabCardBlocks(it, { maxExamples: 2 })
    expect(blocks.find((b) => b.key === 'examples')?.lines).toEqual(['a', 'b'])
    expect(blocks.find((b) => b.key === 'usage')).toBeUndefined()
  })
})

describe('dedupeLibrary', () => {
  it('同 lemma 合并，字段互补', () => {
    const a = item({ id: 'vocab:run', lemma: 'run', word: 'run', phonetic: '/rʌn/', status: 'unqueried' })
    const b = item({ id: 'vocab:run2', lemma: 'run', word: 'running', meaning: '跑', usage: ['run out'] })
    const lib = dedupeLibrary({ schemaVersion: 1, items: [a, b] })
    expect(lib.items).toHaveLength(1)
    expect(lib.items[0]).toMatchObject({ phonetic: '/rʌn/', meaning: '跑' })
    expect(lib.items[0].usage).toEqual(['run out'])
  })
  it('不同 lemma 不动', () => {
    const lib = dedupeLibrary({ schemaVersion: 1, items: [item({ id: 'a', lemma: 'a' }), item({ id: 'b', lemma: 'b' })] })
    expect(lib.items).toHaveLength(2)
  })
  it('合并易混项时保留「有内容那边」的来源', () => {
    const a = item({ id: 'vocab:run', lemma: 'run', word: 'run' })
    const b = item({
      id: 'vocab:run2',
      lemma: 'run',
      word: 'running',
      confusables: [{ word: 'ran' }],
      confusablesSource: 'dict',
    })
    const lib = dedupeLibrary({ schemaVersion: 1, items: [a, b] })
    expect(lib.items[0].confusables).toEqual([{ word: 'ran' }])
    expect(lib.items[0].confusablesSource).toBe('dict')
  })
  it('合并核心字段时来源跟着值走', () => {
    const a = item({
      id: 'vocab:run',
      lemma: 'run',
      word: 'run',
      phonetic: '/rʌn/',
      fieldSources: { phonetic: 'ai' },
    })
    const b = item({
      id: 'vocab:run2',
      lemma: 'run',
      word: 'running',
      meaning: '跑',
      fieldSources: { meaning: 'dict' },
    })
    const lib = dedupeLibrary({ schemaVersion: 1, items: [a, b] })
    expect(lib.items[0]).toMatchObject({ phonetic: '/rʌn/', meaning: '跑' })
    expect(lib.items[0].fieldSources).toEqual({ phonetic: 'ai', meaning: 'dict' })
  })
  it('两边易混项来源不同 → 不冒充单一来源', () => {
    const a = item({
      id: 'vocab:run',
      lemma: 'run',
      word: 'run',
      confusables: [{ word: 'ran' }],
      confusablesSource: 'ai',
    })
    const b = item({
      id: 'vocab:run2',
      lemma: 'run',
      word: 'running',
      confusables: [{ word: 'sprint' }],
      confusablesSource: 'dict',
    })
    const lib = dedupeLibrary({ schemaVersion: 1, items: [a, b] })
    expect(lib.items[0].confusables).toHaveLength(2)
    expect(lib.items[0].confusablesSource).toBeUndefined()
  })
  it('同 lemma 合并时保留「未标注」状态（grammarMarks/phrases 不被写成空数组）', () => {
    const a = item({ id: 'vocab:run', lemma: 'run', word: 'run' })
    const b = item({ id: 'vocab:run2', lemma: 'run', word: 'running' })
    const lib = dedupeLibrary({ schemaVersion: 1, items: [a, b] })
    expect(lib.items[0].grammarMarks).toBeUndefined()
    expect(lib.items[0].phrases).toBeUndefined()
  })
  it('一边已标注（空数组）也视为已标注，另一边的标记会补上', () => {
    const a = item({ id: 'vocab:run', lemma: 'run', word: 'run', grammarMarks: [], phrases: [] })
    const b = item({ id: 'vocab:run2', lemma: 'run', word: 'run', grammarMarks: ['可数'], phrases: ['run out'] })
    const lib = dedupeLibrary({ schemaVersion: 1, items: [a, b] })
    expect(lib.items[0].grammarMarks).toEqual(['可数'])
    expect(lib.items[0].phrases).toEqual(['run out'])
  })
})

describe('marksForPos / normalizeGrammarMarks（按词性过滤语法标记）', () => {
  it('可数性只对名词、及物性只对动词、可分级只对形容词', () => {
    expect(marksForPos(['不可数'], 'v.')).toEqual([]) // sprawl 是动词 → 不该标「不可数」
    expect(marksForPos(['可数', '不及物'], 'n./v.')).toEqual(['可数', '不及物'])
    expect(marksForPos(['及物'], 'adj.')).toEqual([])
    expect(marksForPos(['可分级'], 'adj.')).toEqual(['可分级'])
  })
  it('词性未知 → 先保留；不在受控词表里的扩展标记也保留', () => {
    expect(marksForPos(['不可数'], null)).toEqual(['不可数'])
    expect(marksForPos(['专有名词'], 'n.')).toEqual(['专有名词'])
  })
  it('normalizeGrammarMarks 一次清掉全库不匹配的', () => {
    const lib = { schemaVersion: 1, items: [item({ partOfSpeech: 'v.', grammarMarks: ['不可数', '不及物'] })] }
    expect(normalizeGrammarMarks(lib).items[0].grammarMarks).toEqual(['不及物'])
  })
})

describe('upsertContext / betterSource（多篇语境 / 来源）', () => {
  const ctx = (sentenceText: string, meaning?: string) => ({
    articleId: 'a',
    fileName: 'a',
    sentenceId: null,
    sentenceText,
    meaning,
    at: NOW.toISOString(),
  })
  it('同篇同句只留一条；新句追加；带了新信息才更新', () => {
    let list = upsertContext(undefined, ctx('One.'))
    expect(list).toHaveLength(1)
    expect(upsertContext(list, ctx('One.'))).toHaveLength(1)
    list = upsertContext(list, ctx('One.', '此处：一'))
    expect(list[0].meaning).toBe('此处：一')
    list = upsertContext(list, ctx('Two.'))
    expect(list.map((x) => x.sentenceText)).toEqual(['One.', 'Two.'])
  })
  it('betterSource：有句子的优先，都空则用新的（来源不空）', () => {
    const s = (fileName: string, sentenceText: string) => ({ articleId: fileName, fileName, sentenceId: null, sentenceText })
    expect(betterSource(s('A', 'x'), s('B', ''))?.fileName).toBe('A')
    expect(betterSource(s('A', ''), s('B', 'y'))?.fileName).toBe('B')
  })
})
