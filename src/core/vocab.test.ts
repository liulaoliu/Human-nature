import { describe, it, expect } from 'vitest'
import {
  applyConfusables,
  applyExamples,
  applyLemmaMap,
  applyPhrases,
  applyGrammarMarks,
  applyPosAnalysis,
  applyWordAnalysis,
  articleWordsOf,
  betterSource,
  buildLearnQueue,
  buildReviewQueue,
  buildStudyQueue,
  cleanGloss,
  createLibrary,
  dedupeLibrary,
  displayMeaning,
  dueItems,
  editItem,
  filterItems,
  groupItems,
  hasOwnExamples,
  isDue,
  isMarkablePos,
  isPrinted,
  isPriority,
  lemmaOf,
  markPrinted,
  markWord,
  marksForPos,
  MAX_EXAMPLES,
  needsAiExamples,
  normalizeGrammarMarks,
  normalizeWord,
  normalizePos,
  nextDayIso,
  ownExamples,
  pickOfflineExamples,
  prioritizeItems,
  relemmaLibrary,
  removeByLemma,
  removeItem,
  review,
  reviewItem,
  setStatus,
  sortItems,
  splitGloss,
  unprintedItems,
  upsertContext,
  vocabCardBlocks,
} from './vocab'

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
import type { VocabItem } from '../types/document'

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
  it('maxExamples 截断例句；没有内容的块不出现', () => {
    const it = item({ examples: [{ text: 'a' }, { text: 'b' }, { text: 'c' }] })
    const blocks = vocabCardBlocks(it, { maxExamples: 2 })
    expect(blocks.find((b) => b.key === 'examples')?.lines).toEqual(['a', 'b'])
    expect(blocks.find((b) => b.key === 'usage')).toBeUndefined()
  })
})

const NOW = new Date('2026-10-02T00:00:00.000Z')

function item(over: Partial<VocabItem> = {}): VocabItem {
  return {
    id: 'vocab:test',
    word: 'test',
    lemma: 'test',
    phonetic: null,
    partOfSpeech: null,
    meaning: null,
    usage: [],
    examples: [],
    source: null,
    status: 'unqueried',
    note: '',
    tags: [],
    reviewState: { ease: 2.5, due: null, interval: 0, repetitions: 0 },
    createdAt: NOW.toISOString(),
    updatedAt: NOW.toISOString(),
    ...over,
  }
}

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
})

describe('编辑 / 状态 / 删除', () => {
  it('editItem 默认置为 edited', () => {
    let lib = markWord(createLibrary(), { word: 'run', articleId: 'a1' }, NOW).library
    lib = editItem(lib, lib.items[0].id, { note: '易混淆' }, NOW)
    expect(lib.items[0].note).toBe('易混淆')
    expect(lib.items[0].status).toBe('edited')
  })
  it('setStatus', () => {
    let lib = markWord(createLibrary(), { word: 'run', articleId: 'a1' }, NOW).library
    lib = setStatus(lib, lib.items[0].id, 'mastered', NOW)
    expect(lib.items[0].status).toBe('mastered')
  })
  it('removeItem / removeByLemma', () => {
    const lib = markWord(createLibrary(), { word: 'running', articleId: 'a1' }, NOW).library
    expect(removeItem(lib, lib.items[0].id).items).toHaveLength(0)
    expect(removeByLemma(lib, 'run').items).toHaveLength(0)
  })
})

describe('筛选 / 分组 / 排序', () => {
  const a = item({ id: 'vocab:a', word: 'apple', lemma: 'apple', status: 'queried', source: { articleId: 'art1', fileName: null, sentenceId: null, sentenceText: '' }, tags: ['food'] })
  const b = item({ id: 'vocab:b', word: 'banana', lemma: 'banana', status: 'unqueried', source: { articleId: 'art2', fileName: null, sentenceId: null, sentenceText: '' } })
  const c = item({ id: 'vocab:c', word: 'cherry', lemma: 'cherry', meaning: '樱桃', status: 'mastered', source: { articleId: 'art1', fileName: null, sentenceId: null, sentenceText: '' } })

  it('按状态筛选', () => {
    expect(filterItems([a, b, c], { status: ['queried', 'mastered'] }).map((x) => x.lemma)).toEqual(['apple', 'cherry'])
  })
  it('按文章筛选', () => {
    expect(filterItems([a, b, c], { articleId: 'art1' }).map((x) => x.lemma)).toEqual(['apple', 'cherry'])
  })
  it('按标签筛选', () => {
    expect(filterItems([a, b, c], { tag: 'food' }).map((x) => x.lemma)).toEqual(['apple'])
  })
  it('模糊查询命中含义', () => {
    expect(filterItems([a, b, c], { query: '樱桃' }).map((x) => x.lemma)).toEqual(['cherry'])
  })
  it('按到期日筛选', () => {
    const due = item({ id: 'vocab:d', lemma: 'due', reviewState: { ease: 2.5, due: '2026-09-01T00:00:00.000Z', interval: 1, repetitions: 1 } })
    const future = item({ id: 'vocab:e', lemma: 'future', reviewState: { ease: 2.5, due: '2027-01-01T00:00:00.000Z', interval: 1, repetitions: 1 } })
    expect(filterItems([due, future], { dueBefore: NOW }).map((x) => x.lemma)).toEqual(['due'])
  })
  it('按首字母分组', () => {
    expect(groupItems([a, c], 'alphabet').map((g) => g.key)).toEqual(['A', 'C'])
  })
  it('按文章分组', () => {
    expect(groupItems([a, b, c], 'article').map((g) => g.key)).toEqual(['art1', 'art2'])
  })
  it('按日期分组', () => {
    expect(groupItems([a, b], 'date')[0].key).toBe('2026-10-02')
  })
  it('按状态分组', () => {
    expect(groupItems([a, b, c], 'status').map((g) => g.key).sort()).toEqual(['mastered', 'queried', 'unqueried'])
  })
  it('按字母排序', () => {
    expect(sortItems([c, a, b], 'word').map((x) => x.lemma)).toEqual(['apple', 'banana', 'cherry'])
  })
  it('按到期排序，未排期的排最后', () => {
    const due = item({ id: 'vocab:d', lemma: 'due', reviewState: { ease: 2.5, due: '2026-09-01T00:00:00.000Z', interval: 1, repetitions: 1 } })
    expect(sortItems([b, due], 'due').map((x) => x.lemma)).toEqual(['due', 'banana'])
  })
})

describe('复习排期（SM-2 变体）', () => {
  const fresh = { ease: 2.5, due: null as string | null, interval: 0, repetitions: 0 }

  it('第一次 good：1 天后', () => {
    const r = review(fresh, 'good', NOW)
    expect(r.repetitions).toBe(1)
    expect(r.interval).toBe(1)
    expect(r.due).toBe('2026-10-03T00:00:00.000Z')
  })
  it('第二次 good：6 天后', () => {
    const r = review({ ease: 2.5, due: null, interval: 1, repetitions: 1 }, 'good', NOW)
    expect(r.interval).toBe(6)
  })
  it('第三次 good：interval × ease', () => {
    const r = review({ ease: 2.5, due: null, interval: 6, repetitions: 2 }, 'good', NOW)
    expect(r.interval).toBe(15)
  })
  it('easy 提高 ease', () => {
    const r = review(fresh, 'easy', NOW)
    expect(r.ease).toBeCloseTo(2.6, 5)
  })
  it('again 重来：repetitions 归零、间隔 1 天、ease 下降', () => {
    const r = review({ ease: 2.5, due: null, interval: 15, repetitions: 3 }, 'again', NOW)
    expect(r.repetitions).toBe(0)
    expect(r.interval).toBe(1)
    expect(r.ease).toBeCloseTo(2.3, 5)
  })
  it('ease 下限 1.3', () => {
    const r = review({ ease: 1.3, due: null, interval: 1, repetitions: 1 }, 'again', NOW)
    expect(r.ease).toBe(1.3)
  })
  it('reviewItem 写回词条', () => {
    let lib = markWord(createLibrary(), { word: 'run', articleId: 'a1' }, NOW).library
    lib = reviewItem(lib, lib.items[0].id, 'good', NOW)
    expect(lib.items[0].reviewState.repetitions).toBe(1)
  })
  it('isDue / dueItems', () => {
    const due = item({ id: 'vocab:d', lemma: 'due', reviewState: { ease: 2.5, due: '2026-09-01T00:00:00.000Z', interval: 1, repetitions: 1 } })
    const future = item({ id: 'vocab:e', lemma: 'future', reviewState: { ease: 2.5, due: '2027-01-01T00:00:00.000Z', interval: 1, repetitions: 1 } })
    expect(isDue(due, NOW)).toBe(true)
    expect(isDue(future, NOW)).toBe(false)
    expect(dueItems([future, due], NOW).map((x) => x.lemma)).toEqual(['due'])
  })
})

describe('lemmaOf 短语', () => {
  it('含空格的短语不做词形还原，保持原样（小写）', () => {
    expect(lemmaOf('human rights')).toBe('human rights')
    expect(lemmaOf('Climate Change')).toBe('climate change')
  })
})

describe('dedupeLibrary / buildStudyQueue', () => {
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
  it('学习队列：到期 → 新词 → 其它', () => {
    const now = new Date('2026-10-02T00:00:00Z')
    const due = item({ id: 'd', lemma: 'due', reviewState: { ease: 2.5, due: '2026-09-01T00:00:00Z', interval: 1, repetitions: 2 } })
    const fresh = item({ id: 'f', lemma: 'fresh', reviewState: { ease: 2.5, due: null, interval: 0, repetitions: 0 } })
    const later = item({ id: 'l', lemma: 'later', reviewState: { ease: 2.5, due: '2027-01-01T00:00:00Z', interval: 5, repetitions: 3 } })
    expect(buildStudyQueue([later, fresh, due], now).map((x) => x.lemma)).toEqual(['due', 'fresh', 'later'])
  })
})

describe('出错加权（lapses）', () => {
  it('评「忘记」累计 lapses，其它评分保持', () => {
    const base = { ease: 2.5, due: null, interval: 1, repetitions: 1, lapses: 2 }
    expect(review(base, 'again').lapses).toBe(3)
    expect(review(base, 'good').lapses).toBe(2)
  })
  it('老数据没有 lapses 时按 0 起算', () => {
    expect(review({ ease: 2.5, due: null, interval: 1, repetitions: 1 }, 'again').lapses).toBe(1)
  })
})

describe('articleWordsOf（本篇生词归属）', () => {
  it('来源是本文 → 算本篇；来源在别处但正文出现过 → 也算本篇', () => {
    const lib = {
      schemaVersion: 1,
      items: [
        item({ id: 'vocab:a', lemma: 'estrange', word: 'estrange', source: { articleId: 'art-A', fileName: 'art-A', sentenceId: 's1', sentenceText: 'x' } }),
        item({ id: 'vocab:b', lemma: 'bungle', word: 'bungle', source: null }),
        item({ id: 'vocab:c', lemma: 'unrelated', word: 'unrelated', source: null }),
      ],
    }
    const docLemmas = new Set(['bungle']) // 本文正文里出现了 bungle
    const words = articleWordsOf(lib, 'art-A', docLemmas).map((it) => it.lemma).sort()
    expect(words).toEqual(['bungle', 'estrange'])
  })

  it('markWord 去重：有句子的来源优先，多篇则都进 contexts（回归）', () => {
    let lib = markWord(createLibrary(), { word: 'mitigate', articleId: 'art-A', fileName: 'art-A', sentenceText: 'A sentence.' }, NOW).library
    lib = markWord(lib, { word: 'Mitigating', articleId: 'art-B', fileName: 'art-B', sentenceText: 'B sentence.' }, NOW).library
    expect(lib.items).toHaveLength(1)
    // 有句子的来源保留 A（先来的），B 篇的语境另存 —— 不丢信息
    expect(lib.items[0].source?.fileName).toBe('art-A')
    expect(lib.items[0].contexts?.map((c) => c.fileName).sort()).toEqual(['art-A', 'art-B'])
    // 旧逻辑（只看 source）：art-B 本篇 0 个
    expect(lib.items.filter((it) => it.source?.fileName === 'art-B')).toHaveLength(0)
    // 新逻辑（正文出现过）：art-B 本篇 1 个
    expect(articleWordsOf(lib, 'art-B', new Set(['mitigate']))).toHaveLength(1)
  })

  it('来源为空时用新的（不管手动还是自动选词，来源都要带上）', () => {
    let lib = markWord(createLibrary(), { word: 'x', articleId: 'art-A' }, NOW).library // 没给句子 → 来源为空
    expect(lib.items[0].source?.sentenceText).toBe('')
    lib = markWord(lib, { word: 'x', articleId: 'art-B', fileName: 'art-B', sentenceText: 'B sentence.' }, NOW).library
    expect(lib.items[0].source?.fileName).toBe('art-B')
    expect(lib.items[0].source?.sentenceText).toBe('B sentence.')
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

describe('markWord 词组 / 带释义 / -ed 还原', () => {
  it('markWord 可带释义（词组 — 中文 拆出来的），并直接标 queried', () => {
    const r = markWord(createLibrary(), { word: 'fall back on', articleId: 'a1', meaning: '转而依靠' }, NOW)
    expect(r.created).toBe(true)
    expect(r.item.meaning).toBe('转而依靠')
    expect(r.item.status).toBe('queried')
    expect(r.item.lemma).toBe('fall back on') // 短语不做词形还原
  })
  it('splitGloss：拆「英文 — 中文」（也认 – / -）', () => {
    expect(splitGloss('run out — 用完')).toEqual({ word: 'run out', gloss: '用完' })
    expect(splitGloss('take its toll – 造成损害')).toEqual({ word: 'take its toll', gloss: '造成损害' })
    expect(splitGloss('ensconced')).toEqual({ word: 'ensconced' })
  })
  it('ensconced：启发式 lemma 不完美（ensconc），但原词形保留 + 词典可纠正', () => {
    const r = markWord(createLibrary(), { word: 'ensconced', articleId: 'a1', sentenceText: 'He is ensconced in the job.' }, NOW)
    expect(r.created).toBe(true)
    expect(r.item.word).toBe('ensconced') // 原词形原样留着
    expect(r.item.lemma).toBe('ensconc') // 启发式还原（离线词典就绪后会被自动纠正为 ensconce）
  })
})

describe('优先重排（答错 → 次日排最前）', () => {
  const now = new Date('2026-10-02T00:00:00Z')
  const due = (id: string) =>
    item({ id, lemma: id, reviewState: { ease: 2.5, due: '2026-10-02T00:00:00Z', interval: 3, repetitions: 2 } })

  it('prioritizeItems 只标记指定词条', () => {
    const lib = { schemaVersion: 1, items: [due('a'), due('b')] }
    const out = prioritizeItems(lib, ['a'], nextDayIso(now))
    expect(out.items.find((x) => x.id === 'a')?.priorityUntil).toBe('2026-10-03T00:00:00.000Z')
    expect(out.items.find((x) => x.id === 'b')?.priorityUntil).toBeUndefined()
  })

  it('isPriority 未过期才算', () => {
    expect(isPriority({ priorityUntil: '2026-10-03T00:00:00Z' } as any, now)).toBe(true)
    expect(isPriority({ priorityUntil: '2026-10-01T00:00:00Z' } as any, now)).toBe(false)
    expect(isPriority({} as any, now)).toBe(false)
  })

  it('复习队列把「优先」排到最前', () => {
    const prio = { ...due('p'), priorityUntil: '2026-10-03T00:00:00Z' }
    const plain = { ...due('n'), reviewState: { ...due('n').reviewState, due: '2026-10-01T00:00:00Z' } }
    const q = buildReviewQueue([plain, prio], now)
    expect(q.map((x) => x.id)).toEqual(['p', 'n'])
  })

  it('学习队列同样优先', () => {
    const prio = { ...due('p'), priorityUntil: '2026-10-03T00:00:00Z' }
    const plain = due('n')
    expect(buildStudyQueue([plain, prio], now).map((x) => x.id)).toEqual(['p', 'n'])
  })
})

describe('每日新词配额', () => {
  const now = new Date('2026-10-02T00:00:00Z')
  const fresh = (n: number) =>
    item({ id: `f${n}`, lemma: `f${n}`, reviewState: { ease: 2.5, due: null, interval: 0, repetitions: 0 } })
  it('限制新词数量', () => {
    expect(buildStudyQueue([fresh(1), fresh(2), fresh(3)], now, { newLimit: 2, newToday: 0 })).toHaveLength(2)
  })
  it('当天额度用完就不出新词', () => {
    expect(buildStudyQueue([fresh(1), fresh(2)], now, { newLimit: 2, newToday: 2 })).toHaveLength(0)
  })
  it('不限时不裁剪', () => {
    expect(buildStudyQueue([fresh(1), fresh(2), fresh(3)], now, { newLimit: 0 })).toHaveLength(3)
  })
})

describe('新学习 / 复习 两种队列', () => {
  const now = new Date('2026-10-02T00:00:00Z')
  const fresh = (n: string) =>
    item({ id: `f${n}`, lemma: `f${n}`, reviewState: { ease: 2.5, due: null, interval: 0, repetitions: 0 } })
  const learned = (n: string, due: string, reps = 2) =>
    item({ id: `l${n}`, lemma: `l${n}`, reviewState: { ease: 2.5, due, interval: 3, repetitions: reps } })

  it('新学习：只取没学过的', () => {
    const q = buildLearnQueue([learned('a', '2026-09-01T00:00:00Z'), fresh('b'), fresh('c')], now)
    expect(q.map((x) => x.lemma)).toEqual(['fb', 'fc'])
  })
  it('新学习：受每日配额限制', () => {
    expect(buildLearnQueue([fresh('a'), fresh('b'), fresh('c')], now, { newLimit: 2, newToday: 1 })).toHaveLength(1)
  })
  it('复习：只取已学过且到期的，按到期升序', () => {
    const q = buildReviewQueue(
      [
        learned('later', '2026-12-01T00:00:00Z'),
        learned('overdue', '2026-09-01T00:00:00Z'),
        fresh('new'),
        learned('yesterday', '2026-10-01T00:00:00Z'),
      ],
      now,
    )
    expect(q.map((x) => x.lemma)).toEqual(['loverdue', 'lyesterday'])
  })
  it('复习：没到期 / 没学过的不进队', () => {
    expect(buildReviewQueue([fresh('a'), learned('b', '2027-01-01T00:00:00Z')], now)).toHaveLength(0)
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
    lib = applyConfusables(lib, [{ word: 'adapts', confusables: [{ word: 'adopt', meaning: '采用' }] }], NOW)
    expect(lib.items[0].confusables).toEqual([{ word: 'adopt', meaning: '采用' }])
  })
  it('匹配不到的词条不动', () => {
    const lib = applyConfusables(createLibrary(), [{ word: 'zzz', confusables: [{ word: 'x' }] }], NOW)
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
  it('短语条目不改词形，只记笔记', () => {
    let lib = markWord(createLibrary(), { word: 'sliding oil price', articleId: 'a1' }, NOW).library
    lib = applyPosAnalysis(lib, [row], NOW)
    expect(lib.items[0].word).toBe('sliding oil price')
    expect(lib.items[0].note).toContain('辨析')
  })
})

describe('markPrinted / unprintedItems', () => {
  it('给指定词条写上打印时间，其余不动', () => {
    let lib = markWord(createLibrary(), { word: 'run', articleId: 'a1' }, NOW).library
    lib = markWord(lib, { word: 'jump', articleId: 'a1' }, NOW).library
    const runId = lib.items.find((it) => it.lemma === 'run')!.id
    const out = markPrinted(lib, [runId], NOW)
    expect(out.items.find((it) => it.lemma === 'run')!.lastPrintedAt).toBe(NOW.toISOString())
    expect(out.items.find((it) => it.lemma === 'jump')!.lastPrintedAt).toBeUndefined()
  })
  it('isPrinted / unprintedItems 把没有 lastPrintedAt 的算作未打印', () => {
    let lib = markWord(createLibrary(), { word: 'run', articleId: 'a1' }, NOW).library
    lib = markWord(lib, { word: 'jump', articleId: 'a1' }, NOW).library
    expect(unprintedItems(lib.items)).toHaveLength(2)
    lib = markPrinted(lib, [lib.items[0].id], NOW)
    expect(isPrinted(lib.items[0])).toBe(true)
    expect(unprintedItems(lib.items)).toHaveLength(1)
  })
  it('传空集合原样返回', () => {
    const lib = markWord(createLibrary(), { word: 'run', articleId: 'a1' }, NOW).library
    expect(markPrinted(lib, [])).toBe(lib)
  })
})
