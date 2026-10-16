import { describe, it, expect } from 'vitest'
import { createLibrary, dedupeLibrary, lemmaOf, markWord } from './vocab'
import { TEST_NOW, sentenceFixture, vocabItem } from './testFixtures'
import { filterByKind, isLangPoint, isStudyable, isWordEntry, kindOf, langEntries, wordEntries } from './entryKind'
import {
  groupLangPoints,
  langPointIdOf,
  langPointKeyAndKind,
  langPointSignature,
  languagePointsOf,
  repairLanguageKinds,
  splitGlossText,
  textKey,
  upsertLanguagePoints,
} from './langPoints'
import type { Sentence, SentenceLanguage, VocabItem } from '../types/document'

/**
 * 语言点收藏（词组 / 习语 / 用法）的领域逻辑测试。
 * 单词那一套在 vocab.test.ts；这里只管「收进来是否正确、是否幂等、类型与键是否规矩」。
 */

const NOW = TEST_NOW
describe('splitGlossText（拆「英文 — 中文」）', () => {
  it('拆「英文 — 中文」（也认 – / -）', () => {
    expect(splitGlossText('run out — 用完')).toEqual({ word: 'run out', gloss: '用完' })
    expect(splitGlossText('take its toll – 造成损害')).toEqual({ word: 'take its toll', gloss: '造成损害' })
    expect(splitGlossText('ensconced')).toEqual({ word: 'ensconced' })
  })
})

describe('语言点收进词库（自动收藏：upsertLanguagePoints）', () => {
  const src = (articleId: string, sentenceId: string, sentenceText = 'Sentence.') => ({
    articleId,
    fileName: articleId,
    sentenceId,
    sentenceText,
  })

  it('词组 / 习语 / 用法各建一条，带类型与释义；重复调用返回同一个库（幂等）', () => {
    const pts = [
      { kind: 'phrase' as const, word: 'fall back on', gloss: '转而依靠', source: src('A', 's1') },
      { kind: 'idiom' as const, word: 'take its toll', gloss: '造成损害', source: src('A', 's2') },
      { kind: 'usage' as const, word: '注意 subject to 是形容词', source: src('A', 's3') },
    ]
    const lib = upsertLanguagePoints(createLibrary(), pts, NOW)
    expect(lib.items).toHaveLength(3)
    const phrase = lib.items.find((it) => it.lemma === 'fall back on')!
    expect(phrase.kind).toBe('phrase')
    expect(phrase.meaning).toBe('转而依靠')
    expect(phrase.status).toBe('queried') // 语言点直接带释义收进来，没有「待查」
    expect(phrase.contexts).toHaveLength(1)
    const usage = lib.items.find((it) => it.kind === 'usage')!
    expect(usage.word).toBe('注意 subject to 是形容词')
    expect(usage.meaning).toBeNull()
    // 幂等：再跑一次不该改动
    expect(upsertLanguagePoints(lib, pts, NOW)).toBe(lib)
  })

  it('同一词组在不同文章出现 → 累积语境，不重复建条', () => {
    const first = upsertLanguagePoints(
      createLibrary(),
      [{ kind: 'phrase', word: 'run out', gloss: '用完', source: src('A', 's1') }],
      NOW,
    )
    const second = upsertLanguagePoints(
      first,
      [{ kind: 'phrase', word: 'Run out', gloss: '用完', source: src('B', 's9', 'We ran out of time.') }],
      NOW,
    )
    expect(second.items).toHaveLength(1)
    expect(second.items[0].contexts).toHaveLength(2)
  })

  it('已经手动加进生词本的词组：补上类型与释义，不新建重复条', () => {
    const lib = markWord(createLibrary(), { word: 'fall back on', articleId: 'A', fileName: 'A' }, NOW).library
    const next = upsertLanguagePoints(
      lib,
      [{ kind: 'phrase', word: 'fall back on', gloss: '转而依靠', source: src('A', 's1') }],
      NOW,
    )
    expect(next.items).toHaveLength(1)
    expect(next.items[0].kind).toBe('phrase')
    expect(next.items[0].meaning).toBe('转而依靠')
  })

  it('中文用法笔记不跟单词撞车：另建一条，也不会把已有单词改成「用法」', () => {
    const lib0 = markWord(createLibrary(), { word: 'purge', articleId: 'A', fileName: 'A' }, NOW).library
    const lib = upsertLanguagePoints(
      lib0,
      [{ kind: 'usage', word: '注意 purges 在这里是名词复数', source: src('A', 's1') }],
      NOW,
    )
    expect(lib.items).toHaveLength(2)
    const word = lib.items.find((it) => it.lemma === 'purge')!
    expect(kindOf(word)).toBe('word') // 原本的单词还是单词（能背、能出题）
    const note = lib.items.find((it) => kindOf(it) === 'usage')!
    expect(note.word).toBe('注意 purges 在这里是名词复数')
    expect(note.lemma).toBe(textKey('注意 purges 在这里是名词复数')) // 按整条文本做键
  })

  it('单个英文单词写进「词组」栏：当普通单词收（不标类型），多词的才标 词组', () => {
    const lib = upsertLanguagePoints(
      createLibrary(),
      [
        { kind: 'phrase', word: 'purges', gloss: '清洗', source: src('A', 's1') },
        { kind: 'phrase', word: 'fall back on', gloss: '转而依靠', source: src('A', 's2') },
      ],
      NOW,
    )
    expect(lib.items.find((it) => it.lemma === 'purge')!.kind).toBeUndefined()
    expect(lib.items.find((it) => it.lemma === 'fall back on')!.kind).toBe('phrase')
  })

  it('语言点标记（langPointId）：词形被改写后也不会重复收同一条', () => {
    const src = { articleId: 'A', fileName: 'A', sentenceId: 's1', sentenceText: 'We fall back on it.' }
    const points = [{ kind: 'phrase' as const, word: 'fall back on', gloss: '转而依靠', source: src }]
    const lib = upsertLanguagePoints(createLibrary(), points, NOW)
    expect(lib.items[0].langPointId).toContain('fall back on')
    // 模拟词典把它改名成别的词形：再收一次不该新建
    const renamed = { ...lib, items: [{ ...lib.items[0], word: 'fallback', lemma: 'fallback' }] }
    const again = upsertLanguagePoints(renamed, points, NOW)
    expect(again.items).toHaveLength(1)
  })

  it('repairLanguageKinds：修早先版本误标（单词被标成用法/词组），真笔记不动', () => {
    const mk = (over: Partial<VocabItem>) => vocabItem(over)
    const lib = dedupeLibrary({
      schemaVersion: 1,
      items: [
        mk({ id: 'a', word: 'purge', lemma: 'purge', kind: 'usage' }), // 单词被误标成用法 → 改回
        mk({ id: 'b', word: 'alga', lemma: 'alga', kind: 'phrase' }), // 单词被误标成词组 → 改回
        mk({ id: 'c', word: '注意 purges 是名词', lemma: '注意 purges 是名词', kind: 'usage' }), // 真笔记 → 不动
        mk({ id: 'd', word: 'fall back on', lemma: 'fall back on', kind: 'phrase' }), // 真词组 → 不动
        mk({ id: 'e', word: '注意 purges 在这里是名词复数', lemma: '注意 purges 在这里是名词复数', kind: 'usage', langPointId: 'usage|A|s1|注意 purges 在这里是名词复数' }), // 新代码写的 → 不动
      ],
    })
    const out = repairLanguageKinds(lib)
    const byId = new Map(out.items.map((it) => [it.id, it]))
    expect(byId.get('a')!.kind).toBeUndefined()
    expect(byId.get('b')!.kind).toBeUndefined()
    expect(byId.get('c')!.kind).toBe('usage')
    expect(byId.get('d')!.kind).toBe('phrase')
    expect(byId.get('e')!.kind).toBe('usage')
    expect(repairLanguageKinds(out)).toBe(out) // 幂等
  })

  it('类型过滤：filterByKind；词组可背、用法笔记不背', () => {    const lib = upsertLanguagePoints(
      createLibrary(),
      [
        { kind: 'phrase', word: 'run out', gloss: '用完', source: src('A', 's1') },
        { kind: 'idiom', word: 'take its toll', gloss: '造成损害', source: src('A', 's2') },
        { kind: 'usage', word: '注意 subject to 是形容词', source: src('A', 's3') },
      ],
      NOW,
    )
    expect(filterByKind(lib.items, ['phrase', 'idiom']).map((it) => it.word)).toEqual(['run out', 'take its toll'])
    expect(filterByKind(lib.items)).toBe(lib.items)
    expect(lib.items.filter(isStudyable).map((it) => it.word)).toEqual(['run out', 'take its toll'])
    expect(lib.items.filter(isWordEntry)).toHaveLength(0)
    expect(kindOf(lib.items[0])).toBe('phrase')
    expect(kindOf({})).toBe('word') // 老数据没有 kind
  })
})


describe('languagePointsOf（从句子语言点抽条目）', () => {
  const sentence = (id: string, text: string, languages: SentenceLanguage[]): Sentence => sentenceFixture(id, text, { languages })

  it('抽三类条目：词组/习语拆「英文 — 中文」，用法整条保留，都带来源句', () => {
    const pts = languagePointsOf(
      [
        sentence('s1', 'It takes its toll and we fall back on it.', [
          {
            phrases: ['fall back on — 转而依靠'],
            idioms: ['take its toll — 造成损害'],
            usage: ['注意 subject to 这里是形容词'],
            source: 'ai',
          },
        ]),
      ],
      { articleId: 'A', fileName: 'A' },
    )
    expect(pts.map((p) => [p.kind, p.word, p.gloss])).toEqual([
      ['phrase', 'fall back on', '转而依靠'],
      ['idiom', 'take its toll', '造成损害'],
      ['usage', '注意 subject to 这里是形容词', undefined],
    ])
    expect(pts[0].source).toEqual({ articleId: 'A', fileName: 'A', sentenceId: 's1', sentenceText: 'It takes its toll and we fall back on it.' })
  })

  it('空句数组 / 没有语言点 → 空；兼容旧的单条 language 字段', () => {
    expect(languagePointsOf([], { articleId: 'A' })).toEqual([])
    expect(languagePointsOf([sentence('s1', 'Plain.', [])], { articleId: 'A' })).toEqual([])
    const legacy: Sentence = { ...sentence('s2', 'Old.', []), language: { phrases: ['run out'] } }
    expect(languagePointsOf([legacy], { articleId: 'A' }).map((p) => p.word)).toEqual(['run out'])
  })
})

describe('键 / 类型规则（langPointKeyAndKind）与分组', () => {
  const src = { articleId: 'A', fileName: 'A', sentenceId: 's1', sentenceText: 'Sentence.' }

  it('用法笔记 / 没有英文的说明：整条文本当键，类型 usage', () => {
    expect(langPointKeyAndKind({ kind: 'usage', word: '注意 purges 是名词', source: src })).toEqual({
      key: textKey('注意 purges 是名词'),
      kind: 'usage',
    })
    expect(langPointKeyAndKind({ kind: 'phrase', word: '「死马当活马医」', source: src })).toEqual({
      key: textKey('「死马当活马医」'),
      kind: 'usage',
    })
  })

  it('单个英文单词（AI 写进词组栏）→ 当普通单词；多词 → 按原形，保留词组类型', () => {
    expect(langPointKeyAndKind({ kind: 'phrase', word: 'purges', source: src })).toEqual({ key: lemmaOf('purges') })
    expect(langPointKeyAndKind({ kind: 'idiom', word: 'take its toll', source: src })).toEqual({
      key: 'take its toll',
      kind: 'idiom',
    })
  })

  it('langPointId / 签名：同篇同句同文只算一条；内容变了签名才变', () => {
    const a = { kind: 'phrase' as const, word: 'run out', gloss: '用完', source: src }
    const b = { ...a, gloss: '用光' }
    expect(langPointIdOf(a)).toBe(langPointIdOf({ ...a, gloss: '别的释义' })) // 键不含释义
    expect(langPointSignature([a])).not.toEqual(langPointSignature([b])) // 签名含释义 → 变了要重收
    expect(langPointSignature([a, { ...a, word: 'run in' }])).toEqual(
      expect.objectContaining({ A: expect.any(String) }),
    )
  })

  it('groupLangPoints：按 词组 / 习语 / 用法 分组，空组不出现', () => {
    const lib = upsertLanguagePoints(
      createLibrary(),
      [
        { kind: 'phrase', word: 'run out', gloss: '用完', source: src },
        { kind: 'idiom', word: 'take its toll', gloss: '造成损害', source: { ...src, sentenceId: 's2' } },
        { kind: 'usage', word: '注意 run out 是动词短语', source: { ...src, sentenceId: 's3' } },
      ],
      NOW,
    )
    expect(groupLangPoints(lib.items).map((g) => [g.kind, g.items.length])).toEqual([
      ['phrase', 1],
      ['idiom', 1],
      ['usage', 1],
    ])
    expect(groupLangPoints(wordEntries(lib.items))).toEqual([])
    expect(langEntries(lib.items)).toHaveLength(3)
    expect(lib.items.every(isLangPoint)).toBe(true)
  })
})
